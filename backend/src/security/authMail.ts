import nodemailer from 'nodemailer';

import { env } from '../config/env.js';

export type AuthMail = {
  email: string;
  subject: string;
  link: string;
};
export type SendAuthMail = (mail: AuthMail) => Promise<void>;

const { smtpHost, smtpPort, smtpFrom, smtpSecure, smtpUser, smtpPassword } = env.auth;
const smtp = smtpHost && smtpFrom ? nodemailer.createTransport({
  host: smtpHost,
  port: smtpPort,
  secure: smtpSecure,
  requireTLS: !smtpSecure,
  tls: { rejectUnauthorized: true },
  auth: smtpUser && smtpPassword ? { user: smtpUser, pass: smtpPassword } : undefined,
  connectionTimeout: 8_000,
  greetingTimeout: 8_000,
  socketTimeout: 15_000,
}) : undefined;

export const sendAuthMail: SendAuthMail | undefined = smtp && smtpFrom
  ? async ({ email, subject, link }) => {
    await smtp.sendMail({
      from: smtpFrom,
      to: { address: email, name: '' },
      subject,
      text: `${subject}\n\n${link}\n\nIf you did not make this request, you can ignore this email.`,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  }
  : undefined;
