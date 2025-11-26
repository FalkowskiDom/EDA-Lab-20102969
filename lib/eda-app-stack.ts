import * as cdk from "aws-cdk-lib";
import * as lambdanode from "aws-cdk-lib/aws-lambda-nodejs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import * as events from "aws-cdk-lib/aws-lambda-event-sources";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";
import * as iam from "aws-cdk-lib/aws-iam";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";

import { Construct } from "constructs";
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class EDAAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const imagesBucket = new s3.Bucket(this, "images", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      publicReadAccess: false,
    });

      const imageProcessQueue = new sqs.Queue(this, "img-process-q", {
        receiveMessageWaitTime: cdk.Duration.seconds(10),
    });

      const mailerQ = new sqs.Queue(this, "mailer-q", {
        receiveMessageWaitTime: cdk.Duration.seconds(10),
    });

    // SNS
      const newImageTopic = new sns.Topic(this, "NewImageTopic", {
        displayName: "New Image topic",
    }); 

    newImageTopic.addSubscription(new subs.SqsSubscription(imageProcessQueue));
    newImageTopic.addSubscription(new subs.SqsSubscription(mailerQ));

    const mailerTopic = new sns.Topic(this, "MailerTopic", {
      displayName: "Mailer topic",
    });

    mailerTopic.addSubscription(new subs.SqsSubscription(mailerQ));

  // Lambda functions

        const imagesTable = new dynamodb.Table(this, "ImagesTable", {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      partitionKey: { name: "name", type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      tableName: "Imagess",
 });

     const processImageFn = new lambdanode.NodejsFunction(
      this,
      "ProcessImageFn",
 {
        runtime: lambda.Runtime.NODEJS_18_X,
        entry: `${__dirname}/../lambdas/processImage.ts`,
        timeout: cdk.Duration.seconds(15),
        memorySize: 128,
        environment: {
          TABLE_NAME: imagesTable.tableName,
          BUCKET_NAME: imagesBucket.bucketName,
          REGION: 'eu-west-1'
 },
 }
 );

     const addMetadataFn = new lambdanode.NodejsFunction(
      this,
      "addMetadataFn",
 {
        runtime: lambda.Runtime.NODEJS_20_X,
        entry: `${__dirname}/../lambdas/addImageMetadata.ts`,
        timeout: cdk.Duration.seconds(15),
        memorySize: 128,
        environment: {
          TABLE_NAME: imagesTable.tableName,
        },
    }
 );


    //  NEW
    const dlq = new sqs.Queue(this, "img-dlq", {
      receiveMessageWaitTime: cdk.Duration.seconds(10),
 });
    // UPDATE
    const queue = new sqs.Queue(this, "img-created-queue", {
      receiveMessageWaitTime: cdk.Duration.seconds(10),
      deadLetterQueue: {
        queue: dlq,
        maxReceiveCount: 1
 }
 });

const rejectedImageFn = new lambdanode.NodejsFunction(
  this,
  "RejectedImagesFn",
  {
    runtime: lambda.Runtime.NODEJS_20_X,
    entry: `${__dirname}/../lambdas/rejectedImages.ts`,
    timeout: cdk.Duration.seconds(15),
    memorySize: 128,
  }
);

const rejectedImageEventSource = new events.SqsEventSource(dlq, {
  batchSize: 5,
  maxBatchingWindow: cdk.Duration.seconds(10),
});

rejectedImageFn.addEventSource(rejectedImageEventSource);


   const mailerFn = new lambdanode.NodejsFunction(this, "mailer", {
      runtime: lambda.Runtime.NODEJS_16_X,
      memorySize: 1024,
      timeout: cdk.Duration.seconds(3),
      entry: `${__dirname}/../lambdas/mailer.ts`,
    });


    // S3 --> SQS
    imagesBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.SnsDestination(newImageTopic)
    );

   // SQS --> Lambda
    const newImageEventSource = new events.SqsEventSource(imageProcessQueue, {
      batchSize: 5,
      maxBatchingWindow: cdk.Duration.seconds(5),
    });

    const newImageMailEventSource = new events.SqsEventSource(mailerQ, {
      batchSize: 5,
      maxBatchingWindow: cdk.Duration.seconds(5),
    }); 

    processImageFn.addEventSource(newImageEventSource);
    mailerFn.addEventSource(newImageMailEventSource);
    mailerFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "ses:SendEmail",
          "ses:SendRawEmail",
          "ses:SendTemplatedEmail",
        ],
        resources: ["*"],
      })
    );

        newImageTopic.addSubscription(
      new subs.LambdaSubscription(addMetadataFn, {
        filterPolicy: {
          metadata_type: sns.SubscriptionFilter.stringFilter({
            allowlist: ["Caption", "Date", "Photographer"],
      }),
      },
    })
 );
 
  newImageTopic.addSubscription(
      new subs.SqsSubscription(imageProcessQueue, {
        filterPolicyWithMessageBody: {
          Records: sns.FilterOrPolicy.policy({
            s3: sns.FilterOrPolicy.policy({
              object: sns.FilterOrPolicy.policy({
                key: sns.FilterOrPolicy.filter(
                  sns.SubscriptionFilter.stringFilter({
                    matchPrefixes: ["image"],
                 })

             ),
           }),
         }),
         }),
         },
        rawMessageDelivery: true,
      })
 );

 newImageTopic.addSubscription(
      new subs.SqsSubscription(mailerQ, {
        filterPolicyWithMessageBody: {
          Records: sns.FilterOrPolicy.policy({
            s3: sns.FilterOrPolicy.policy({
              object: sns.FilterOrPolicy.policy({
                key: sns.FilterOrPolicy.filter(
                  sns.SubscriptionFilter.stringFilter({
                    matchPrefixes: ["image"],
                  })
                ),
              }),
            }),
           }),
         },
        rawMessageDelivery: true,
      })
 );

    // Permissions
    imagesBucket.grantRead(processImageFn);
    imagesBucket.grantRead(mailerFn);
    imagesTable.grantReadWriteData(processImageFn);

    new cdk.CfnOutput(this, "SNS Topic ARN", {
      value: newImageTopic.topicArn ,
     });

    // Output
    new cdk.CfnOutput(this, "bucketName", {
      value: imagesBucket.bucketName,
    });
  }
}
