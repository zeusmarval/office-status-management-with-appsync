# Office Status Management with AppSync

This repository contains an AWS CloudFormation template to set up a serverless application for managing office status changes in real-time using AWS AppSync, DynamoDB, Lambda, and other AWS services.

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Prerequisites](#prerequisites)
- [Deployment](#deployment)
- [Usage](#usage)
  - [GraphQL API](#graphql-api)
  - [Authentication](#authentication)
  - [Logging](#logging)
- [Clean Up](#clean-up)

## Overview

The template provisions the following AWS resources:

- **AWS AppSync**: Provides a GraphQL API for managing office statuses and user associations.
- **AWS Lambda**: Custom resolvers and JWT validation.
- **AWS Secrets Manager**: Stores JWT secret keys.
- **AWS IAM**: Manages roles and permissions.
- **Amazon DynamoDB**: Stores user and office data.
- **AWS CloudWatch**: Logs AppSync operations.

## Features

- **User Management**: Create and manage users and their associations with offices.
- **Office Management**: Create offices and update their statuses.
- **Real-Time Updates**: Subscribe to office status changes in real-time.
- **Secure Authentication**: JWT-based authentication and authorization for API operations.
- **Logging**: CloudWatch logging for monitoring and debugging.

## Prerequisites

- An AWS account.
- AWS CLI configured with appropriate permissions.
- Node.js installed for Lambda function development.

## Deployment

1. **Clone the repository:**

    ```sh
    git clone https://github.com/zeusmarval/office-status-management-with-appsync
    cd office-status-appsync
    ```

2. **Package the stack:**

    ```sh
    sam build --use-container
    ```

3. **Deploy the CloudFormation stack:**

    ```sh
    aws cloudformation deploy \
        --template-file template.yaml \
        --stack-name OfficeStatusAppSync \
        --capabilities CAPABILITY_NAMED_IAM
    ```

4. **Note the outputs**: After the stack is created, note the outputs for `GraphQLApiId` and `GraphQLApiEndpoint` from the CloudFormation console.

## Usage

### GraphQL API

- **API Endpoint**: The endpoint for the AppSync GraphQL API can be found in the CloudFormation stack outputs.
- **GraphQL Schema**: The schema defines the following types, queries, mutations, and subscriptions:

    #### Types

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

The GraphQL API uses JWT-based authentication. The JWT secret is stored in AWS Secrets Manager and fetched by the Lambda authorizer function.

### Logging

AppSync operations are logged to CloudWatch for monitoring and debugging purposes.

## Clean Up

To delete the CloudFormation stack and all resources created:

```sh
aws cloudformation delete-stack --stack-name OfficeStatusAppSync

