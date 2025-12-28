# Office Status Management with AppSync

This repository contains an AWS SAM (Serverless Application Model) template to set up a serverless application for managing office status changes in real-time using AWS AppSync, DynamoDB, Lambda, and other AWS services.

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Prerequisites](#prerequisites)
- [Deployment](#deployment)
- [Usage](#usage)
  - [GraphQL API](#graphql-api)
  - [Authentication](#authentication)
  - [Authorization](#authorization)
  - [Logging](#logging)
- [Project Structure](#project-structure)
- [Created Resources](#created-resources)
- [Clean Up](#clean-up)
- [Environment Configuration](#environment-configuration)
- [Contributing](#contributing)
- [License](#license)

## Overview

The template provisions the following AWS resources:

- **AWS AppSync**: Provides a GraphQL API for managing office statuses and user associations.
- **AWS Lambda**: Authorizer function with JWT validation and secret caching.
- **AWS Secrets Manager**: Stores JWT secret keys.
- **AWS IAM**: Manages roles and permissions.
- **Amazon DynamoDB**: Stores user and office data (two tables: `UsersTable` and `OfficesTable`).
- **AWS CloudWatch**: Logs AppSync and Lambda operations.
- **AWS X-Ray**: Enabled for API tracing.

## Features

- **User Management**: Create and manage users and their associations with offices.
- **Office Management**: Create offices and update their statuses (online, offline, busy, away).
- **Real-Time Updates**: Subscribe to office status changes in real-time with permission-based filtering.
- **Secure Authentication**: JWT-based authentication and authorization for API operations.
- **Access Control**: Permission system that differentiates between admin users and regular users.
- **Secret Caching**: The Lambda authorizer implements caching to reduce latency in token validation.
- **Structured Logging**: Structured logging in CloudWatch for monitoring and debugging.

## Prerequisites

- An AWS account.
- AWS CLI configured with appropriate permissions.
- AWS SAM CLI installed.
- Node.js 22.x or higher installed.
- Docker installed (for `sam build --use-container`).

## Deployment

1. **Clone the repository:**

    ```sh
    git clone https://github.com/zeusmarval/office-status-management-with-appsync
    cd office-status-management-with-aws-appsync
    ```

2. **Install dependencies for the token generation script (optional):**

    ```sh
    npm install
    ```

3. **Build the application:**

    ```sh
    sam build --use-container
    ```

4. **Deploy the stack:**

    ```sh
    sam deploy
    ```

    Or to specify a different environment:

    ```sh
    sam deploy --parameter-overrides Environment=qa
    ```

    Available environments are: `dev`, `qa`, `prod` (default: `dev`).

5. **Note the outputs**: After the stack is created, note the outputs for `GraphQLApiId` and `GraphQLApiEndpoint` from the CloudFormation console or by running:

    ```sh
    aws cloudformation describe-stacks --stack-name dev-offices-status --query 'Stacks[0].Outputs'
    ```

## Usage

### GraphQL API

- **API Endpoint**: The endpoint for the AppSync GraphQL API can be found in the CloudFormation stack outputs.
- **GraphQL Schema**: The schema defines the following types, queries, mutations, and subscriptions:

    #### Types and Operations

    ```graphql
    type Mutation {
      createUser(userId: ID!, officeId: [ID!]): User
      addOfficeUser(userId: ID!, officeId: ID!): User
      createOffice(officeId: ID!, officeName: String!): Office
      statusOffice(officeId: ID!, status: String!): StatusOffice
    }

    type Office {
      officeId: ID!
      officeName: String!
      status: String!
    }

    type StatusOffice {
      officeId: ID!
      status: String!
    }

    type User {
      userId: ID!
      officeId: [ID!]
    }

    type Subscription {
      onCreateOffice: StatusOffice
        @aws_subscribe(mutations: ["statusOffice"])
    }

    type Query {
      getOfficeByID(officeId: ID!): Office
      getOffices: [Office]
    }

    schema {
      query: Query
      mutation: Mutation
      subscription: Subscription
    }
    ```

### Authentication

The GraphQL API uses JWT-based authentication. The JWT secret is stored in AWS Secrets Manager and retrieved by the Lambda authorizer function. The authorizer implements secret caching to improve performance (configurable TTL, default 15 minutes).

**Authentication Flow:**
1. The client sends a JWT token in the `Authorization: Bearer <token>` header
2. The Lambda authorizer validates the token using the secret stored in Secrets Manager
3. If the token is valid, it verifies if the user exists in DynamoDB (except for `admin` users)
4. The resolver context is set with the user's permissions

### Authorization

The system implements two levels of authorization:

- **Admin Users**: Users with `userId: "admin"` have full access to all operations and offices.
- **Regular Users**: Can only access offices associated with their `userId` in the `UsersTable`.

**Operation Restrictions:**
- `getOfficeByID`: Regular users can only query offices they have access to.
- `getOffices`: Admins get all offices (Scan), regular users only their allowed offices (BatchGetItem).
- `statusOffice`: Regular users can only update the status of offices they have access to. Valid statuses are: `online`, `offline`, `busy`, `away`.
- `onCreateOffice` (Subscription): Regular users only receive updates from their allowed offices through subscription filtering.

### Testing with JWT Tokens

To test the API, you need to generate a JWT token. A utility script is provided for this purpose.

#### Prerequisites

1. Install dependencies in the project root:
   ```sh
   npm install
   ```

2. Configure AWS credentials:
   ```sh
   aws configure
   ```

#### Generate a Token

**For admin access:**
```sh
node scripts/generate-token.mjs admin
```

**For a regular user:**
```sh
node scripts/generate-token.mjs user123
```

**With custom expiration (2 hours):**
```sh
node scripts/generate-token.mjs user123 --expires-in 7200
```

**With a specific secret key (without AWS access):**
```sh
node scripts/generate-token.mjs user123 --secret-key "your-secret-key"
```

**With a specific secret name:**
```sh
node scripts/generate-token.mjs user123 --secret-name "dev-offices-status-jwt-validation"
```

**With a specific AWS region:**
```sh
node scripts/generate-token.mjs user123 --region us-west-2
```

#### Using the Token

Once you have the token, use it in your GraphQL requests:

**With curl:**
```sh
curl -X POST \
  https://your-appsync-endpoint/graphql \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -H "Content-Type: application/json" \
  -d '{"query": "{ getOffices { officeId officeName status } }"}'
```

**With a GraphQL client:**
```javascript
const response = await fetch('https://your-appsync-endpoint/graphql', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    query: `
      query {
        getOffices {
          officeId
          officeName
          status
        }
      }
    `,
  }),
});
```

**Note:** For admin users, the token will grant full access. For regular users, make sure the user exists in the DynamoDB `UsersTable` with the corresponding `userId` and an `officeId` array with the allowed offices.

#### Complete Flow Example

1. **Create a user:**
   ```graphql
   mutation {
     createUser(userId: "user123", officeId: ["office1", "office2"]) {
       userId
       officeId
     }
   }
   ```

2. **Create an office:**
   ```graphql
   mutation {
     createOffice(officeId: "office1", officeName: "Main Office") {
       officeId
       officeName
       status
     }
   }
   ```

3. **Update office status:**
   ```graphql
   mutation {
     statusOffice(officeId: "office1", status: "online") {
       officeId
       status
     }
   }
   ```

4. **Subscribe to status changes:**
   ```graphql
   subscription {
     onCreateOffice {
       officeId
       status
     }
   }
   ```

### Logging

AppSync and Lambda operations are logged to CloudWatch for monitoring and debugging:

- **AppSync Logs**: Available in `/aws/appsync/apis/<ApiId>` with log level `ALL`
- **Lambda Logs**: Available in `/aws/lambda/<StackName>-jwt-authorizer` with retention of 1 day (dev/qa) or 7 days (prod)
- **X-Ray**: Enabled for API tracing

The Lambda authorizer implements structured logging with automatic sanitization of sensitive information.

## Project Structure

```
office-status-management-with-aws-appsync/
├── src/
│   └── lambdas/
│       └── authorizer/
│           ├── index.mjs          # Lambda authorizer function
│           └── package.json       # Authorizer dependencies
├── scripts/
│   ├── generate-token.mjs         # Script to generate JWT tokens
│   └── package.json               # Script dependencies
├── template.yml                    # AWS SAM template
├── samconfig.toml                  # SAM CLI configuration
└── README.md                       # This file
```

## Created Resources

The stack creates the following resources in AWS:

### DynamoDB Tables
- **UsersTable**: Stores users and their associations with offices
  - Partition key: `userId` (String)
  - Attributes: `officeId` (List of Strings), `createdAt`, `updatedAt`
- **OfficesTable**: Stores office information
  - Partition key: `officeId` (String)
  - Attributes: `officeName` (String), `status` (String), `createdAt`, `updatedAt`

### Lambda Functions
- **JWTAuthorizerFunction**: Validates JWT tokens and sets authorization context
  - Runtime: Node.js 22.x
  - Timeout: 5 seconds
  - Memory: 128 MB
  - Secret cache: 15 minutes (configurable)

### Secrets Manager
- **JWTValidationSecret**: Stores the secret key for JWT validation
  - Policy: Retain (not deleted when stack is deleted)

### AppSync
- **GraphQL API**: GraphQL API with Lambda authentication
- **Data Sources**: 
  - `UsersDataSource`: Connection to UsersTable
  - `OfficesDataSource`: Connection to OfficesTable
  - `EmptyDataSource`: For subscriptions
- **Resolvers**: Resolvers for all GraphQL operations
- **Logging**: Enabled with `ALL` level in CloudWatch
- **X-Ray**: Enabled for tracing

## Clean Up

To delete the CloudFormation stack and all created resources:

```sh
sam delete --stack-name dev-offices-status
```

Or using AWS CLI:

```sh
aws cloudformation delete-stack --stack-name dev-offices-status
```

**Important Note:** The secret in Secrets Manager has an `UpdateReplacePolicy: Retain` policy, so it will not be automatically deleted. If you want to delete it manually:

```sh
aws secretsmanager delete-secret --secret-id dev-offices-status-jwt-validation --force-delete-without-recovery
```

## Environment Configuration

The stack supports multiple environments through the `Environment` parameter:

- **dev**: Development environment (default)
- **qa**: Quality assurance environment
- **prod**: Production environment

To deploy to a specific environment:

```sh
sam deploy --parameter-overrides Environment=qa
```

Resource names are automatically generated using the format: `<Environment>-<Project>-<Resource>`

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for more information on how to contribute to the project.

## License

This project is licensed under the License specified in [LICENSE](LICENSE).
