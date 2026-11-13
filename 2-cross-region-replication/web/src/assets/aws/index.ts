// Official AWS Architecture Icons (release 07/31/2026), unmodified SVGs from the
// asset package at https://aws.amazon.com/architecture/icons/ — see README.md.
// Imported as URLs and drawn with <img>/<image> so their internal gradient ids
// never collide when the same icon appears several times on one page.
import lambda from "./Arch_AWS-Lambda_48.svg";
import cloudfront from "./Arch_Amazon-CloudFront_48.svg";
import cloudwatch from "./Arch_Amazon-CloudWatch_48.svg";
import dynamodb from "./Arch_Amazon-DynamoDB_48.svg";
import eventbridge from "./Arch_Amazon-EventBridge_48.svg";
import glacier from "./Arch_Amazon-Simple-Storage-Service-Glacier_48.svg";
import s3 from "./Arch_Amazon-Simple-Storage-Service_48.svg";
import bucket from "./Res_Amazon-Simple-Storage-Service_Bucket_48.svg";
import object from "./Res_Amazon-Simple-Storage-Service_Object_48.svg";
import batch from "./Res_Amazon-Simple-Storage-Service_S3-Batch-Operations_48.svg";
import replication from "./Res_Amazon-Simple-Storage-Service_S3-Replication_48.svg";
import client from "./Res_Client_48_Light.svg";
import app from "./Res_Generic-Application_48_Light.svg";
import user from "./Res_User_48_Light.svg";

export const AWS_ICON = { lambda, cloudfront, cloudwatch, dynamodb, eventbridge, glacier, s3, bucket, object, batch, replication, client, app, user } as const;
export type AwsIcon = keyof typeof AWS_ICON;
