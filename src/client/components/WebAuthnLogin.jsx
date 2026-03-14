/**
 * Personal Vault — WebAuthn Passkey Helpers
 * Browser-side functions for passkey registration and authentication.
 */

// ============================================================================
// Base64URL Helpers
// ============================================================================

/**
 * Encode an ArrayBuffer to a base64url string (no padding).
 */
function base64urlEncode(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Decode a base64url string to an ArrayBuffer.
 */
function base64urlDecode(str) {
  // Restore standard base64 characters and padding
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// ============================================================================
// Feature Detection
// ============================================================================

/**
 * Check if the browser supports WebAuthn.
 */
export function isWebAuthnSupported() {
  return !!(window.PublicKeyCredential && navigator.credentials);
}

// ============================================================================
// Registration Flow
// ============================================================================

/**
 * Register a new passkey for the current authenticated user.
 *
 * @param {import('axios').AxiosInstance} api  Axios instance with JWT auth
 * @param {string}                       name Display name for the passkey
 * @returns {Promise<object>} Server response with credentialId and name
 */
export async function registerPasskey(api, name) {
  // 1. Request registration options from server
  const optionsRes = await api.post('/webauthn.php?action=register-options');
  const { challengeId, publicKey } = optionsRes.data.data;

  // 2. Convert base64url fields to ArrayBuffers for the browser API
  const createOptions = {
    publicKey: {
      ...publicKey,
      challenge: base64urlDecode(publicKey.challenge),
      user: {
        ...publicKey.user,
        id: base64urlDecode(publicKey.user.id),
      },
      excludeCredentials: (publicKey.excludeCredentials || []).map((cred) => ({
        ...cred,
        id: base64urlDecode(cred.id),
      })),
    },
  };

  // 3. Create credential via browser WebAuthn API
  const credential = await navigator.credentials.create(createOptions);

  // 4. Encode response fields as base64url for transport to server
  const clientDataJSON = base64urlEncode(credential.response.clientDataJSON);
  const attestationObject = base64urlEncode(credential.response.attestationObject);

  // Get transports if available (e.g., "internal", "usb", "ble", "nfc")
  const transports = credential.response.getTransports
    ? credential.response.getTransports()
    : [];

  // 5. Send to server for verification and storage
  const verifyRes = await api.post('/webauthn.php?action=register-verify', {
    challengeId,
    clientDataJSON,
    attestationObject,
    transports,
    name: name || undefined,
  });

  return verifyRes.data.data;
}

// ============================================================================
// Conditional Mediation (Autofill) Flow
// ============================================================================

let _mediationController = null;

/**
 * Start conditional mediation — passkeys appear in the browser autofill UI.
 * Silently no-ops on unsupported browsers.
 *
 * @param {import('axios').AxiosInstance} api  Axios instance (no JWT needed)
 * @param {(data: object) => void} onSuccess  Called with auth result on success
 * @param {(err: Error) => void}   onError    Called on non-cancellation errors
 */
export async function startConditionalMediation(api, onSuccess, onError) {
  try {
    if (
      !window.PublicKeyCredential ||
      !PublicKeyCredential.isConditionalMediationAvailable ||
      !(await PublicKeyCredential.isConditionalMediationAvailable())
    ) {
      return; // Browser doesn't support conditional mediation
    }

    // Get challenge from server
    const optionsRes = await api.post('/webauthn.php?action=auth-options');
    const { challengeId, publicKey } = optionsRes.data.data;

    // Set up abort controller
    _mediationController = new AbortController();

    // Request credential with conditional mediation (autofill)
    const assertion = await navigator.credentials.get({
      publicKey: {
        ...publicKey,
        challenge: base64urlDecode(publicKey.challenge),
        allowCredentials: [],
      },
      mediation: 'conditional',
      signal: _mediationController.signal,
    });

    // Encode response for server
    const clientDataJSON = base64urlEncode(assertion.response.clientDataJSON);
    const authenticatorData = base64urlEncode(assertion.response.authenticatorData);
    const signature = base64urlEncode(assertion.response.signature);
    const credentialId = base64urlEncode(assertion.rawId);

    // Verify with server
    const verifyRes = await api.post('/webauthn.php?action=auth-verify', {
      challengeId,
      clientDataJSON,
      authenticatorData,
      signature,
      credentialId,
    });

    _mediationController = null;
    onSuccess(verifyRes.data.data);
  } catch (err) {
    _mediationController = null;
    // Silently ignore user cancellation and abort
    if (err.name === 'AbortError' || err.name === 'NotAllowedError') {
      return;
    }
    if (onError) onError(err);
  }
}

/**
 * Abort any pending conditional mediation request.
 */
export function abortConditionalMediation() {
  if (_mediationController) {
    _mediationController.abort();
    _mediationController = null;
  }
}

// ============================================================================
// Authentication Flow (Explicit / Button Click)
// ============================================================================

/**
 * Authenticate using a passkey (no prior login required).
 *
 * @param {import('axios').AxiosInstance} api  Axios instance (no JWT needed)
 * @returns {Promise<{token: string, user: object, expires_in: number}>}
 */
export async function authenticateWithPasskey(api) {
  // 1. Request authentication options from server
  const optionsRes = await api.post('/webauthn.php?action=auth-options');
  const { challengeId, publicKey } = optionsRes.data.data;

  // 2. Convert base64url fields to ArrayBuffers for the browser API
  const getOptions = {
    publicKey: {
      ...publicKey,
      challenge: base64urlDecode(publicKey.challenge),
      allowCredentials: (publicKey.allowCredentials || []).map((cred) => ({
        ...cred,
        id: base64urlDecode(cred.id),
      })),
    },
  };

  // 3. Get assertion via browser WebAuthn API
  const assertion = await navigator.credentials.get(getOptions);

  // 4. Encode response fields as base64url for transport to server
  const clientDataJSON = base64urlEncode(assertion.response.clientDataJSON);
  const authenticatorData = base64urlEncode(assertion.response.authenticatorData);
  const signature = base64urlEncode(assertion.response.signature);
  const credentialId = base64urlEncode(assertion.rawId);

  // 5. Send to server for verification
  const verifyRes = await api.post('/webauthn.php?action=auth-verify', {
    challengeId,
    clientDataJSON,
    authenticatorData,
    signature,
    credentialId,
  });

  return verifyRes.data.data;
}
