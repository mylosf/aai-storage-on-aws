// Official AWS Architecture Icons (release 07/31/2026), unmodified SVGs from the
// asset package at https://aws.amazon.com/architecture/icons/ — see README.md.
// Imported as URLs and drawn with <img>/<image> so their internal gradient ids
// never collide when the same icon appears several times on one page.
import cloudfront from "./Arch_Amazon-CloudFront_48.svg";
import ec2 from "./Arch_Amazon-EC2_48.svg";
import efs from "./Arch_Amazon-EFS_48.svg";
import fsxLustre from "./Arch_Amazon-FSx-for-Lustre_48.svg";
import fsxOntap from "./Arch_Amazon-FSx-for-NetApp-ONTAP_48.svg";
import fsxWindows from "./Arch_Amazon-FSx-for-WFS_48.svg";
import glacier from "./Arch_Amazon-Simple-Storage-Service-Glacier_48.svg";
import ebs from "./Arch_Amazon-Elastic-Block-Store_48.svg";
import s3 from "./Arch_Amazon-Simple-Storage-Service_48.svg";
import ssm from "./Arch_AWS-Systems-Manager_48.svg";
import instance from "./Res_Amazon-EC2_Instance_48.svg";
import client from "./Res_Client_48_Light.svg";
import app from "./Res_Generic-Application_48_Light.svg";
import user from "./Res_User_48_Light.svg";

export const AWS_ICON = {
  client,
  user,
  app,
  cloudfront,
  ec2,
  instance,
  ebs,
  efs,
  fsxWindows,
  fsxLustre,
  fsxOntap,
  s3,
  glacier,
  ssm,
} as const;

export type AwsIcon = keyof typeof AWS_ICON;

export const AWS_ICON_TITLE: Record<AwsIcon, string> = {
  client: "Client",
  user: "User",
  app: "Application",
  cloudfront: "Amazon CloudFront",
  ec2: "Amazon EC2",
  instance: "EC2 instance (instance store)",
  ebs: "Amazon EBS",
  efs: "Amazon EFS",
  fsxWindows: "Amazon FSx for Windows File Server",
  fsxLustre: "Amazon FSx for Lustre",
  fsxOntap: "Amazon FSx for NetApp ONTAP",
  s3: "Amazon S3",
  glacier: "Amazon S3 Glacier",
  ssm: "AWS Systems Manager",
};
