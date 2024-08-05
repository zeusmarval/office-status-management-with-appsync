import jwt from "jsonwebtoken";
import AWS from "aws-sdk";

const secretsmanager = new AWS.SecretsManager();
const dynamodb = new AWS.DynamoDB.DocumentClient();

const secretArn = process.env.SECRET_ARN;

export const handler = async (event) => {
  const token = event.authorizationToken;
  const secret = await secretsmanager
    .getSecretValue({ SecretId: secretArn })
    .promise();
  const secretKey = JSON.parse(secret.SecretString).secretKey;

  const decodedToken = jwt.verify(token, secretKey);
  const userId = decodedToken.sub;
  
  if (userId === "admin") return { isAuthorized: true };

  const user = await dynamodb.get({
      TableName: "UsersTable",
      Key: { userId: userId },
    }).promise();

  if (!user.Item) return { isAuthorized: false, deniedFields: [] };

  const allowedOffices = JSON.stringify(user.Item.officeId);
  
  return {
    isAuthorized: true,
    resolverContext: {
      allowedOffices: allowedOffices,
    },
  };
};
