#!/usr/bin/env node

/**
 * Script to generate JWT tokens for testing the AppSync authorizer
 * 
 * Usage:
 *   node scripts/generate-token.mjs <userId> [options]
 * 
 * Examples:
 *   node scripts/generate-token.mjs admin
 *   node scripts/generate-token.mjs user123
 *   node scripts/generate-token.mjs user123 --secret-key "your-secret-key"
 *   node scripts/generate-token.mjs user123 --expires-in 3600
 */

import jwt from "jsonwebtoken";
import AWS from "aws-sdk";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const secretsmanager = new AWS.SecretsManager();

// Parse command line arguments
const args = process.argv.slice(2);
const userId = args[0];

if (!userId) {
  console.error("Error: userId is required");
  console.log("\nUsage: node scripts/generate-token.mjs <userId> [options]");
  console.log("\nOptions:");
  console.log("  --secret-key <key>     Use a specific secret key (default: fetch from AWS Secrets Manager)");
  console.log("  --secret-name <name>   Secret name in AWS Secrets Manager (default: from stack)");
  console.log("  --expires-in <seconds> Token expiration in seconds (default: 3600 = 1 hour)");
  console.log("  --region <region>      AWS region (default: us-east-1)");
  console.log("\nExamples:");
  console.log("  node scripts/generate-token.mjs admin");
  console.log("  node scripts/generate-token.mjs user123 --expires-in 7200");
  console.log("  node scripts/generate-token.mjs user123 --secret-key 'my-secret-key'");
  process.exit(1);
}

// Parse options
let secretKey = null;
let secretName = null;
let expiresIn = 3600; // 1 hour default
let region = process.env.AWS_REGION || "us-east-1";

for (let i = 1; i < args.length; i++) {
  switch (args[i]) {
    case "--secret-key":
      secretKey = args[++i];
      break;
    case "--secret-name":
      secretName = args[++i];
      break;
    case "--expires-in":
      expiresIn = parseInt(args[++i], 10);
      break;
    case "--region":
      region = args[++i];
      break;
    default:
      console.error(`Unknown option: ${args[i]}`);
      process.exit(1);
  }
}

// Get secret key from AWS Secrets Manager if not provided
const getSecretKey = async () => {
  if (secretKey) {
    return secretKey;
  }

  try {
    // Try to get secret name from environment or use default pattern
    if (!secretName) {
      const stackName = process.env.STACK_NAME || "dev-office-status";
      secretName = `${stackName}-jwt-validation`;
    }

    console.log(`Fetching secret from AWS Secrets Manager: ${secretName}`);
    
    AWS.config.update({ region });
    const secret = await secretsmanager
      .getSecretValue({ SecretId: secretName })
      .promise();

    const secretData = JSON.parse(secret.SecretString);
    
    if (!secretData.secretKey) {
      throw new Error("Secret key not found in secret data");
    }

    return secretData.secretKey;
  } catch (error) {
    console.error("Error fetching secret from AWS:", error.message);
    console.log("\nTip: You can provide the secret key directly using --secret-key option");
    console.log("Or set STACK_NAME environment variable to match your CloudFormation stack name");
    process.exit(1);
  }
};

// Generate JWT token
const generateToken = async () => {
  try {
    const key = await getSecretKey();
    
    const payload = {
      sub: userId,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + expiresIn,
    };

    const token = jwt.sign(payload, key, {
      algorithm: "HS256",
    });

    console.log("\n" + "=".repeat(80));
    console.log("JWT Token Generated Successfully");
    console.log("=".repeat(80));
    console.log("\nToken:");
    console.log(token);
    console.log("\nPayload:");
    console.log(JSON.stringify(payload, null, 2));
    console.log("\nExpires in:", expiresIn, "seconds (" + (expiresIn / 60).toFixed(1) + " minutes)");
    console.log("\n" + "=".repeat(80));
    console.log("\nTo use this token with AppSync:");
    console.log("  Authorization: Bearer " + token);
    console.log("\nOr in GraphQL requests:");
    console.log('  { "Authorization": "Bearer ' + token + '" }');
    console.log("\n" + "=".repeat(80) + "\n");

    return token;
  } catch (error) {
    console.error("Error generating token:", error.message);
    process.exit(1);
  }
};

generateToken();

