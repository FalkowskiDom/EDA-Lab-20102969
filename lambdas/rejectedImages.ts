import { SQSHandler } from "aws-lambda";



export const handler: SQSHandler = async (event) => {
  console.log("Event ", event);
  for (const record of event.Records) {
    const recordBody = JSON.parse(record.body);
    if (recordBody.Records) {
      for (const s3Message of recordBody.Records) {
        const s3e = s3Message.s3;
        const srcBucket = s3e.bucket.name;
        console.log("Rejected file: ", s3Message.s3.object.key);
 }
 }
 }
};