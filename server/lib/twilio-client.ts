import twilio from 'twilio';

let cachedCredentials: {
  accountSid: string;
  authToken: string;
  phoneNumber: string;
} | null = null;

async function getCredentialsFromConnector(): Promise<{
  accountSid: string;
  authToken: string;
  phoneNumber: string;
} | null> {
  try {
    const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
    if (!hostname) {
      return null;
    }

    const xReplitToken = process.env.REPL_IDENTITY 
      ? 'repl ' + process.env.REPL_IDENTITY 
      : process.env.WEB_REPL_RENEWAL 
      ? 'depl ' + process.env.WEB_REPL_RENEWAL 
      : null;

    if (!xReplitToken) {
      return null;
    }

    const response = await fetch(
      'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=twilio',
      {
        headers: {
          'Accept': 'application/json',
          'X_REPLIT_TOKEN': xReplitToken
        }
      }
    );
    
    const data = await response.json();
    const connectionSettings = data.items?.[0];

    if (connectionSettings?.settings?.account_sid && connectionSettings?.settings?.api_key && connectionSettings?.settings?.api_key_secret) {
      return {
        accountSid: connectionSettings.settings.account_sid,
        authToken: connectionSettings.settings.api_key_secret,
        phoneNumber: connectionSettings.settings.phone_number || ''
      };
    }
    
    return null;
  } catch (error) {
    console.log('Replit Twilio connector not available, falling back to environment variables');
    return null;
  }
}

function getCredentialsFromEnv(): {
  accountSid: string;
  authToken: string;
  phoneNumber: string;
} | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const phoneNumber = process.env.TWILIO_PHONE_NUMBER || '';

  if (accountSid && authToken) {
    return { accountSid, authToken, phoneNumber };
  }
  
  return null;
}

async function getCredentials() {
  if (cachedCredentials) {
    return cachedCredentials;
  }

  const connectorCreds = await getCredentialsFromConnector();
  if (connectorCreds) {
    cachedCredentials = connectorCreds;
    return connectorCreds;
  }

  const envCreds = getCredentialsFromEnv();
  if (envCreds) {
    cachedCredentials = envCreds;
    return envCreds;
  }

  throw new Error('Twilio not configured. Please set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER environment variables.');
}

export async function getTwilioClient() {
  const { accountSid, authToken } = await getCredentials();
  return twilio(accountSid, authToken);
}

export async function getTwilioFromPhoneNumber() {
  const { phoneNumber } = await getCredentials();
  if (!phoneNumber) {
    throw new Error('Twilio phone number not configured. Please set TWILIO_PHONE_NUMBER environment variable.');
  }
  return phoneNumber;
}

export function clearTwilioCredentialsCache() {
  cachedCredentials = null;
}
