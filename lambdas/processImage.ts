/* eslint-disable import/extensions, import/no-absolute-path */
import { SQSHandler } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import {
  GetObjectCommand,
  PutObjectCommandInput,
  GetObjectCommandInput,
  S3Client,
  PutObjectCommand,
} from "@aws-sdk/client-s3";

const s3 = new S3Client();

const ddbDocClient = createDDbDocClient();


function createDDbDocClient() {
  const ddbClient = new DynamoDBClient({ region: process.env.REGION });
  const marshallOptions = {
    convertEmptyValues: true,
    removeUndefinedValues: true,
    convertClassInstanceToMap: true,
 };
  const unmarshallOptions = {
    wrapNumbers: false,
 };
  const translateConfig = { marshallOptions, unmarshallOptions };
  return DynamoDBDocumentClient.from(ddbClient, translateConfig);
}

export const handler: SQSHandler = async (event) => {
  console.log("Event ", JSON.stringify(event));
  for (const record of event.Records) {
    const recordBody = JSON.parse(record.body);        // Parse SQS message
    const snsMessage = JSON.parse(recordBody.Message); // Parse SNS message

    if (snsMessage.Records) {
      console.log("Record body ", JSON.stringify(snsMessage));
      for (const s3Message of snsMessage.Records) {
        try{
        const s3e = s3Message.s3;
        const srcBucket = s3e.bucket.name;
        // Object key may have spaces or unicode non-ASCII characters.
        const srcKey = decodeURIComponent(s3e.object.key.replace(/\+/g, " "));
        
        // Infer the image type from the file suffix.
        const typeMatch = srcKey.match(/\.([^.]*)$/);
        if (!typeMatch) {
          console.log("Could not determine the image type.");
          throw new Error("Could not determine the image type.");
        }
        
        // Check that the image type is supported
        const imageType = typeMatch[1].toLowerCase();
        if (imageType != "jpeg" && imageType != "png") {
          throw new Error(`Unsupported image type: ${imageType}`);
        }

        // Store the image information in DynamoDB
        await ddbDocClient.send(
          new PutCommand({
            TableName: process.env.TABLE_NAME,
            Item: {
              name: srcKey,
            },
          })
        );
        
        // Download the image from the S3 source bucket
        const params: GetObjectCommandInput = {
          Bucket: srcBucket,
          Key: srcKey,
        };
        const theImage = await s3.send(new GetObjectCommand(params));
        // Process the image ......
        } catch (error) {
          console.log(error);
        }
      }
    }
  };
};