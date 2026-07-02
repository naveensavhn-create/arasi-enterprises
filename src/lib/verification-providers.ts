/**
 * Verification provider registry.
 *
 * This module is client-safe: it declares the shape of each provider's
 * configuration (non-secret fields) and its credential fields (secret
 * fields — never persisted here, just enumerated so the UI can render
 * the correct inputs and the server can validate incoming payloads).
 *
 * Adding a new provider — say PAN verification or DigiLocker — is a matter
 * of appending a new entry under the correct verification type; no changes
 * to the settings server functions or admin UI are required.
 */

export type VerificationType = "mobile_otp" | "email";
export type VerificationRequirement = "mandatory" | "optional" | "disabled";

export type ProviderFieldType = "text" | "password" | "number" | "select";

export type ProviderField = {
  key: string;
  label: string;
  type: ProviderFieldType;
  placeholder?: string;
  help?: string;
  options?: string[];
  optional?: boolean;
};

export type VerificationProviderDef = {
  id: string;
  label: string;
  requiresCredentials: boolean;
  configFields: ProviderField[];
  credentialFields: ProviderField[];
};

// --- Mobile OTP providers ---------------------------------------------------

const commonOtpConfig: ProviderField[] = [
  { key: "sender_id", label: "Sender ID", type: "text", placeholder: "ARASI", optional: true },
  { key: "otp_length", label: "OTP length", type: "number", placeholder: "6" },
  { key: "otp_expiry_minutes", label: "OTP expiry (minutes)", type: "number", placeholder: "10" },
  { key: "max_retry_attempts", label: "Max retry attempts", type: "number", placeholder: "5" },
  { key: "rate_limit_per_hour", label: "Rate limit (per phone / hour)", type: "number", placeholder: "10" },
  {
    key: "country_code_allow_list",
    label: "Allowed country codes (comma separated)",
    type: "text",
    placeholder: "+91, +971",
    optional: true,
    help: "Leave blank to allow all. Values are matched as prefixes on the E.164 number.",
  },
];

const mobileProviders: VerificationProviderDef[] = [
  {
    id: "msg91",
    label: "MSG91",
    requiresCredentials: true,
    configFields: [
      { key: "template_id", label: "Template ID", type: "text", placeholder: "6..." },
      ...commonOtpConfig,
    ],
    credentialFields: [{ key: "auth_key", label: "Auth Key", type: "password" }],
  },
  {
    id: "twilio",
    label: "Twilio Verify",
    requiresCredentials: true,
    configFields: [
      { key: "verify_service_sid", label: "Verify Service SID", type: "text", placeholder: "VA..." },
      ...commonOtpConfig,
    ],
    credentialFields: [
      { key: "account_sid", label: "Account SID", type: "password" },
      { key: "auth_token", label: "Auth Token", type: "password" },
    ],
  },
  {
    id: "custom_http",
    label: "Custom HTTP",
    requiresCredentials: true,
    configFields: [
      { key: "send_url", label: "Send URL (POST)", type: "text", placeholder: "https://..." },
      { key: "verify_url", label: "Verify URL (POST)", type: "text", placeholder: "https://..." },
      ...commonOtpConfig,
    ],
    credentialFields: [
      { key: "api_key", label: "API Key", type: "password" },
      { key: "api_secret", label: "API Secret", type: "password", optional: true },
    ],
  },
];

// --- Email providers --------------------------------------------------------

const commonEmailConfig: ProviderField[] = [
  { key: "sender_email", label: "Sender email", type: "text", placeholder: "noreply@arasi.example" },
  { key: "sender_name", label: "Sender name", type: "text", placeholder: "ARASI Enterprises" },
  { key: "link_expiry_minutes", label: "Verification link expiry (minutes)", type: "number", placeholder: "60" },
  { key: "otp_expiry_minutes", label: "Email OTP expiry (minutes)", type: "number", placeholder: "15" },
  { key: "max_retry_attempts", label: "Max retry attempts", type: "number", placeholder: "5" },
];

const emailProviders: VerificationProviderDef[] = [
  {
    id: "resend",
    label: "Resend",
    requiresCredentials: true,
    configFields: [...commonEmailConfig],
    credentialFields: [{ key: "api_key", label: "API Key (re_...)", type: "password" }],
  },
  {
    id: "sendgrid",
    label: "SendGrid",
    requiresCredentials: true,
    configFields: [...commonEmailConfig],
    credentialFields: [{ key: "api_key", label: "API Key", type: "password" }],
  },
  {
    id: "smtp",
    label: "SMTP",
    requiresCredentials: true,
    configFields: [
      { key: "smtp_host", label: "SMTP Host", type: "text", placeholder: "smtp.example.com" },
      { key: "smtp_port", label: "SMTP Port", type: "number", placeholder: "587" },
      {
        key: "encryption",
        label: "Encryption",
        type: "select",
        options: ["tls", "ssl", "none"],
      },
      ...commonEmailConfig,
    ],
    credentialFields: [
      { key: "smtp_username", label: "SMTP Username", type: "password" },
      { key: "smtp_password", label: "SMTP Password", type: "password" },
    ],
  },
];

export const VERIFICATION_PROVIDERS: Record<VerificationType, VerificationProviderDef[]> = {
  mobile_otp: mobileProviders,
  email: emailProviders,
};

// --- Test connection request builder ---------------------------------------

export type TestRequest = {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
  isSuccess: (status: number, body: string) => boolean;
};

export function buildTestForProvider(
  providerId: string,
  credentials: Record<string, string>,
  _config: Record<string, unknown>,
): TestRequest | null {
  switch (providerId) {
    case "msg91": {
      if (!credentials.auth_key) return null;
      return {
        url: `https://control.msg91.com/api/balance.php?authkey=${encodeURIComponent(credentials.auth_key)}&type=4`,
        method: "GET",
        headers: { accept: "text/plain" },
        // Success: HTTP 200 and body is a non-negative number, not an error phrase.
        isSuccess: (status, body) => status === 200 && !/error|invalid|auth/i.test(body),
      };
    }
    case "twilio": {
      if (!credentials.account_sid || !credentials.auth_token) return null;
      const basic = btoa(`${credentials.account_sid}:${credentials.auth_token}`);
      return {
        url: `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(credentials.account_sid)}.json`,
        method: "GET",
        headers: { authorization: `Basic ${basic}`, accept: "application/json" },
        isSuccess: (status) => status === 200,
      };
    }
    case "resend": {
      if (!credentials.api_key) return null;
      return {
        url: "https://api.resend.com/domains",
        method: "GET",
        headers: { authorization: `Bearer ${credentials.api_key}`, accept: "application/json" },
        isSuccess: (status) => status === 200,
      };
    }
    case "sendgrid": {
      if (!credentials.api_key) return null;
      return {
        url: "https://api.sendgrid.com/v3/scopes",
        method: "GET",
        headers: { authorization: `Bearer ${credentials.api_key}`, accept: "application/json" },
        isSuccess: (status) => status === 200,
      };
    }
    // SMTP and custom HTTP need raw TCP or arbitrary URLs — not reachable in
    // the standard test flow. Return null so the caller records a friendly
    // "test not available" message without failing.
    default:
      return null;
  }
}
