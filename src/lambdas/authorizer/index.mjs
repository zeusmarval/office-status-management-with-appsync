import jwt from "jsonwebtoken";
import AWS from "aws-sdk";

const secretsmanager = new AWS.SecretsManager();
const dynamodb = new AWS.DynamoDB.DocumentClient();

const secretArn = process.env.SECRET_ARN;
const tableName = process.env.USERS_TABLE_NAME || "UsersTable";
const CACHE_TTL = parseInt(process.env.CACHE_TTL || "900000", 10);

let cachedSecret = null;
let cacheTimestamp = null;

/**
 * Sanitizes data for logging (removes sensitive information)
 * Only redacts string values that match sensitive patterns, not numeric counters
 */
const sanitizeForLogging = (data, enableSanitization = true) => {
  if (!enableSanitization) {
    return data;
  }

  if (!data || typeof data !== "object") {
    return data;
  }

  // Fields that should never be redacted (counters, statistics, IDs)
  const allowedFields = [
    "userId",
    "officeId",
    "tableName",
    "cacheTimestamp",
    "durationMs",
    "statusCode",
  ];

  // Sensitive patterns that should trigger redaction (only for string values)
  const sensitivePatterns = [
    /^apiKey$/i,
    /^key$/i,
    /token/i,
    /secret/i,
    /password/i,
    /authorization/i,
    /credential/i,
    /auth/i,
  ];

  const sanitized = { ...data };

  for (const key in sanitized) {
    const lowerKey = key.toLowerCase();
    
    // Skip if field is in allowed list
    if (allowedFields.some((af) => lowerKey === af.toLowerCase())) {
      continue;
    }

    // Only redact string values that match sensitive patterns
    if (typeof sanitized[key] === "string" && sensitivePatterns.some((pattern) => pattern.test(key))) {
      sanitized[key] = "[REDACTED]";
    } else if (typeof sanitized[key] === "object" && sanitized[key] !== null && !Array.isArray(sanitized[key])) {
      sanitized[key] = sanitizeForLogging(sanitized[key], enableSanitization);
    }
  }

  return sanitized;
};

/**
 * Gets sanitization setting from config (defaults to true for security)
 */
let globalSanitizationEnabled = true;

/**
 * Sets the global sanitization setting
 */
const setSanitizationEnabled = (enabled) => {
  globalSanitizationEnabled = enabled;
};

// Structured logging configuration
const logger = {
  info: (message, data = {}) => {
    console.log(JSON.stringify({
      level: "INFO",
      message,
      ...sanitizeForLogging(data, globalSanitizationEnabled),
      timestamp: new Date().toISOString(),
    }));
  },
  error: (message, error = {}, data = {}) => {
    // Do not expose stack traces in production
    const errorInfo = {
      name: error.name,
      message: error.message,
      code: error.code,
      statusCode: error.$metadata?.httpStatusCode,
    };

    console.error(JSON.stringify({
      level: "ERROR",
      message,
      error: errorInfo,
      ...sanitizeForLogging(data, globalSanitizationEnabled),
      timestamp: new Date().toISOString(),
    }));
  },
  warn: (message, data = {}) => {
    console.warn(JSON.stringify({
      level: "WARN",
      message,
      ...sanitizeForLogging(data, globalSanitizationEnabled),
      timestamp: new Date().toISOString(),
    }));
  },
};

const getCachedSecret = async () => {
  const currentTime = Date.now();
  
  if (cachedSecret === null || cacheTimestamp === null || (currentTime - cacheTimestamp > CACHE_TTL)) {
    try {
      if (!secretArn) {
        throw new Error("SECRET_ARN environment variable is not defined");
      }
      
      const secret = await secretsmanager
        .getSecretValue({ SecretId: secretArn })
        .promise();
      
      const secretData = JSON.parse(secret.SecretString);
      if (!secretData.secretKey) {
        throw new Error("Secret key not found in secret data");
      }
      
      cachedSecret = secretData.secretKey;
      cacheTimestamp = currentTime;
      
      logger.info("Secret retrieved and cached", {
        cacheTimestamp: currentTime,
      });
    } catch (error) {
      logger.error("Error retrieving secret", error, {
        secretArn: secretArn ? "[REDACTED]" : undefined,
      });
      throw error;
    }
  }
  
  return cachedSecret;
};

const denyAccess = (reason, data = {}) => {
  logger.warn("Access denied", {
    reason,
    ...data,
  });
  return {
    isAuthorized: false,
    deniedFields: [],
  };
};

export const handler = async (event) => {
  const startTime = Date.now();
  
  try {
    logger.info("Authorizer function started", {
      hasEvent: !!event,
      hasToken: !!(event?.authorizationToken),
    });

    if (!event || !event.authorizationToken) {
      return denyAccess("Missing authorization token", {
        hasEvent: !!event,
      });
    }

    const token = event.authorizationToken;
    
    if (!token || typeof token !== "string" || token.trim().length === 0) {
      return denyAccess("Invalid authorization token format", {
        tokenType: typeof token,
        tokenLength: token?.length,
      });
    }

    const secretKey = await getCachedSecret();
    
    if (!secretKey) {
      logger.error("Secret key is null or undefined");
      return denyAccess("Internal server error");
    }

    let decodedToken;
    try {
      decodedToken = jwt.verify(token, secretKey);
      logger.info("JWT token verified successfully", {
        userId: decodedToken?.sub,
      });
    } catch (error) {
      logger.warn("JWT verification failed", {
        errorName: error.name,
        errorMessage: error.message,
      });
      return denyAccess("Invalid or expired token");
    }

    if (!decodedToken || !decodedToken.sub) {
      return denyAccess("Token missing required claims", {
        hasDecodedToken: !!decodedToken,
        hasSub: !!decodedToken?.sub,
      });
    }

    const userId = decodedToken.sub;
    
    if (userId === "admin") {
      const duration = Date.now() - startTime;
      logger.info("Admin access granted", {
        userId,
        durationMs: duration,
      });
      return {
        isAuthorized: true,
        resolverContext: {
          isAdmin: "true",
          allowedOffices: JSON.stringify([]),
        },
      };
    }

    let user;
    try {
      const result = await dynamodb.get({
        TableName: tableName,
        Key: { userId: userId },
      }).promise();
      
      user = result.Item;
      
      logger.info("User queried from DynamoDB", {
        userId,
        userFound: !!user,
        tableName,
      });
    } catch (error) {
      logger.error("Error querying DynamoDB", error, {
        userId,
        tableName,
      });
      return denyAccess("Internal server error");
    }

    if (!user) {
      return denyAccess("User not found", {
        userId,
        tableName,
      });
    }

    const officeId = user.officeId;
    const allowedOffices = officeId && Array.isArray(officeId) && officeId.length > 0
      ? JSON.stringify(officeId)
      : JSON.stringify([]);
    
    const duration = Date.now() - startTime;
    logger.info("Access granted", {
      userId,
      officeCount: officeId && Array.isArray(officeId) ? officeId.length : 0,
      durationMs: duration,
    });
    
    return {
      isAuthorized: true,
      resolverContext: {
        allowedOffices: allowedOffices,
      },
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error("Unexpected error in authorizer", error, {
      durationMs: duration,
    });
    return denyAccess("Internal server error", {
      durationMs: duration,
    });
  }
};
