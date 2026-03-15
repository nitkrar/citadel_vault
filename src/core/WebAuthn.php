<?php
/**
 * Personal Vault — WebAuthn Passkey Support
 * Zero-dependency WebAuthn implementation with minimal CBOR decoder.
 * Supports ES256 (-7) algorithm only (ECDSA with P-256 and SHA-256).
 */
require_once __DIR__ . '/../../config/config.php';

// ============================================================================
// Minimal CBOR Decoder
// Handles: unsigned ints, negative ints, byte strings, text strings,
//          arrays, maps — enough for WebAuthn attestation objects.
// ============================================================================
class CborDecoder {
    private string $data;
    private int $offset;

    public function __construct(string $data) {
        $this->data = $data;
        $this->offset = 0;
    }

    /**
     * Decode a CBOR-encoded binary string into a PHP value.
     */
    public static function decode(string $data) {
        $decoder = new self($data);
        return $decoder->decodeItem();
    }

    private function decodeItem() {
        if ($this->offset >= strlen($this->data)) {
            throw new RuntimeException('CBOR: unexpected end of data');
        }

        $byte = ord($this->data[$this->offset]);
        $this->offset++;

        $majorType = ($byte >> 5) & 0x07;
        $additional = $byte & 0x1F;

        switch ($majorType) {
            case 0: // Unsigned integer
                return $this->decodeUnsigned($additional);

            case 1: // Negative integer
                $val = $this->decodeUnsigned($additional);
                return -1 - $val;

            case 2: // Byte string
                $len = $this->decodeUnsigned($additional);
                $bytes = substr($this->data, $this->offset, $len);
                $this->offset += $len;
                return $bytes;

            case 3: // Text string
                $len = $this->decodeUnsigned($additional);
                $text = substr($this->data, $this->offset, $len);
                $this->offset += $len;
                return $text;

            case 4: // Array
                $count = $this->decodeUnsigned($additional);
                $arr = [];
                for ($i = 0; $i < $count; $i++) {
                    $arr[] = $this->decodeItem();
                }
                return $arr;

            case 5: // Map
                $count = $this->decodeUnsigned($additional);
                $map = [];
                for ($i = 0; $i < $count; $i++) {
                    $key = $this->decodeItem();
                    $value = $this->decodeItem();
                    $map[$key] = $value;
                }
                return $map;

            case 6: // Tagged value (consume tag, return inner value)
                $this->decodeUnsigned($additional); // tag number, ignored
                return $this->decodeItem();

            case 7: // Simple values and floats
                if ($additional === 20) return false;
                if ($additional === 21) return true;
                if ($additional === 22) return null;
                if ($additional === 25) { // half-precision float
                    $half = unpack('n', substr($this->data, $this->offset, 2))[1];
                    $this->offset += 2;
                    return $this->halfToFloat($half);
                }
                if ($additional === 26) { // single-precision float
                    $float = unpack('G', substr($this->data, $this->offset, 4))[1];
                    $this->offset += 4;
                    return $float;
                }
                if ($additional === 27) { // double-precision float
                    $float = unpack('E', substr($this->data, $this->offset, 8))[1];
                    $this->offset += 8;
                    return $float;
                }
                throw new RuntimeException("CBOR: unsupported simple value $additional");

            default:
                throw new RuntimeException("CBOR: unsupported major type $majorType");
        }
    }

    /**
     * Decode the additional information field into an unsigned integer.
     */
    private function decodeUnsigned(int $additional): int {
        if ($additional < 24) {
            return $additional;
        }
        if ($additional === 24) {
            $val = ord($this->data[$this->offset]);
            $this->offset += 1;
            return $val;
        }
        if ($additional === 25) {
            $val = unpack('n', substr($this->data, $this->offset, 2))[1];
            $this->offset += 2;
            return $val;
        }
        if ($additional === 26) {
            $val = unpack('N', substr($this->data, $this->offset, 4))[1];
            $this->offset += 4;
            return $val;
        }
        if ($additional === 27) {
            // 64-bit — read as two 32-bit values
            $hi = unpack('N', substr($this->data, $this->offset, 4))[1];
            $lo = unpack('N', substr($this->data, $this->offset + 4, 4))[1];
            $this->offset += 8;
            return ($hi << 32) | $lo;
        }
        throw new RuntimeException("CBOR: unsupported additional value $additional");
    }

    /**
     * Convert IEEE 754 half-precision float to PHP float.
     */
    private function halfToFloat(int $half): float {
        $sign = ($half >> 15) & 0x01;
        $exp  = ($half >> 10) & 0x1F;
        $frac = $half & 0x03FF;

        if ($exp === 0) {
            $val = $frac * pow(2, -24);
        } elseif ($exp === 31) {
            $val = ($frac === 0) ? INF : NAN;
        } else {
            $val = ($frac + 1024) * pow(2, $exp - 25);
        }

        return $sign ? -$val : $val;
    }
}

// ============================================================================
// WebAuthn Functions
// ============================================================================

/**
 * Parse authenticator data from a WebAuthn response.
 *
 * @param  string $authData Raw authenticator data bytes
 * @return array  Parsed structure with rpIdHash, flags, signCount, and
 *                optional attestedCredentialData (aaguid, credentialId, coseKey)
 */
function parseAuthenticatorData(string $authData): array {
    if (strlen($authData) < 37) {
        throw new RuntimeException('Authenticator data too short');
    }

    $rpIdHash  = substr($authData, 0, 32);
    $flagsByte = ord($authData[32]);
    $signCount = unpack('N', substr($authData, 33, 4))[1];

    $flags = [
        'UP' => (bool)($flagsByte & 0x01),  // User Present
        'UV' => (bool)($flagsByte & 0x04),  // User Verified
        'BE' => (bool)($flagsByte & 0x08),  // Backup Eligibility
        'BS' => (bool)($flagsByte & 0x10),  // Backup State
        'AT' => (bool)($flagsByte & 0x40),  // Attested Credential Data
        'ED' => (bool)($flagsByte & 0x80),  // Extension Data
    ];

    $result = [
        'rpIdHash'  => $rpIdHash,
        'flags'     => $flags,
        'flagsByte' => $flagsByte,
        'signCount' => $signCount,
    ];

    // Parse attested credential data if present (AT flag set)
    if ($flags['AT'] && strlen($authData) > 37) {
        $offset = 37;

        // AAGUID: 16 bytes
        $aaguid = substr($authData, $offset, 16);
        $offset += 16;

        // Credential ID length: 2 bytes big-endian
        $credIdLen = unpack('n', substr($authData, $offset, 2))[1];
        $offset += 2;

        // Credential ID
        $credentialId = substr($authData, $offset, $credIdLen);
        $offset += $credIdLen;

        // COSE public key (remaining bytes decoded from CBOR)
        $coseKeyBytes = substr($authData, $offset);
        $coseKey = CborDecoder::decode($coseKeyBytes);

        $result['attestedCredentialData'] = [
            'aaguid'       => $aaguid,
            'credentialId' => $credentialId,
            'coseKey'      => $coseKey,
        ];
    }

    return $result;
}

/**
 * Convert an EC2 P-256 COSE key (from attestation) to PEM format.
 * Only supports kty=2 (EC2), alg=-7 (ES256), crv=1 (P-256).
 *
 * @param  array  $coseKey Decoded COSE key map (integer keys)
 * @return string PEM-encoded public key
 */
function coseKeyToPem(array $coseKey): string {
    // COSE key parameters (integer labels):
    //  1 = kty (2 = EC2)
    //  3 = alg (-7 = ES256)
    // -1 = crv (1 = P-256)
    // -2 = x coordinate (32 bytes)
    // -3 = y coordinate (32 bytes)
    $kty = $coseKey[1] ?? null;
    $alg = $coseKey[3] ?? null;
    $crv = $coseKey[-1] ?? null;
    $x   = $coseKey[-2] ?? null;
    $y   = $coseKey[-3] ?? null;

    if ($kty !== 2) {
        throw new RuntimeException('COSE key type must be EC2 (kty=2)');
    }
    if ($alg !== null && $alg !== -7) {
        throw new RuntimeException('Only ES256 (alg=-7) is supported');
    }
    if ($crv !== 1) {
        throw new RuntimeException('Only P-256 curve (crv=1) is supported');
    }
    if (!$x || !$y || strlen($x) !== 32 || strlen($y) !== 32) {
        throw new RuntimeException('Invalid EC2 key coordinates');
    }

    // Uncompressed point: 0x04 || x || y
    $uncompressedPoint = "\x04" . $x . $y;

    // ASN.1 DER encoding for EC P-256 public key:
    // SEQUENCE {
    //   SEQUENCE {
    //     OID 1.2.840.10045.2.1 (EC public key)
    //     OID 1.2.840.10045.3.1.7 (P-256 / prime256v1)
    //   }
    //   BIT STRING (uncompressed point)
    // }
    $ecOid    = "\x06\x07\x2A\x86\x48\xCE\x3D\x02\x01"; // OID 1.2.840.10045.2.1
    $curveOid = "\x06\x08\x2A\x86\x48\xCE\x3D\x03\x01\x07"; // OID 1.2.840.10045.3.1.7

    $algorithmIdentifier = "\x30" . chr(strlen($ecOid) + strlen($curveOid)) . $ecOid . $curveOid;

    // BIT STRING: 1 byte for number of unused bits (0x00) + the point data
    $bitString = "\x03" . chr(strlen($uncompressedPoint) + 1) . "\x00" . $uncompressedPoint;

    $der = "\x30" . chr(strlen($algorithmIdentifier) + strlen($bitString))
         . $algorithmIdentifier . $bitString;

    $pem  = "-----BEGIN PUBLIC KEY-----\n";
    $pem .= chunk_split(base64_encode($der), 64, "\n");
    $pem .= "-----END PUBLIC KEY-----\n";

    return $pem;
}

/**
 * Base64URL encode (no padding).
 */
function webauthnBase64UrlEncode(string $data): string {
    return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}

/**
 * Base64URL decode.
 */
function webauthnBase64UrlDecode(string $data): string {
    $padded = str_pad($data, strlen($data) + (4 - strlen($data) % 4) % 4, '=');
    $decoded = base64_decode(strtr($padded, '-_', '+/'), true);
    if ($decoded === false) {
        throw new RuntimeException('Invalid base64url encoding');
    }
    return $decoded;
}

/**
 * Generate WebAuthn registration options (PublicKeyCredentialCreationOptions).
 *
 * @param  PDO    $db
 * @param  int    $userId
 * @param  string $username
 * @return array  Options to pass to navigator.credentials.create()
 */
function webauthnRegisterOptions(PDO $db, int $userId, string $username): array {
    // Generate a random challenge (32 bytes)
    $challenge = random_bytes(32);
    $challengeB64 = webauthnBase64UrlEncode($challenge);

    // Store challenge in DB with 5-minute expiry
    $stmt = $db->prepare(
        "INSERT INTO webauthn_challenges (challenge, user_id, type, expires_at)
         VALUES (?, ?, 'register', DATE_ADD(NOW(), INTERVAL 5 MINUTE))"
    );
    $stmt->execute([$challengeB64, $userId]);
    $challengeId = (int)$db->lastInsertId();

    // Get existing credentials for this user (to exclude)
    $stmt = $db->prepare(
        "SELECT credential_id FROM user_credentials_webauthn WHERE user_id = ?"
    );
    $stmt->execute([$userId]);
    $existingCreds = $stmt->fetchAll(PDO::FETCH_COLUMN);

    $excludeCredentials = [];
    foreach ($existingCreds as $credId) {
        $excludeCredentials[] = [
            'type' => 'public-key',
            'id'   => $credId,
        ];
    }

    $options = [
        'challengeId' => $challengeId,
        'publicKey'   => [
            'rp' => [
                'id'   => WEBAUTHN_RP_ID,
                'name' => WEBAUTHN_RP_NAME,
            ],
            'user' => [
                'id'          => webauthnBase64UrlEncode(pack('N', $userId)),
                'name'        => $username,
                'displayName' => $username,
            ],
            'challenge'            => $challengeB64,
            'pubKeyCredParams'     => [
                ['type' => 'public-key', 'alg' => -7], // ES256
            ],
            'timeout'              => 60000, // 60 seconds
            'attestation'          => 'none',
            'excludeCredentials'   => $excludeCredentials,
            'authenticatorSelection' => [
                'authenticatorAttachment' => 'platform',
                'residentKey'             => 'required',
                'userVerification'        => 'preferred',
            ],
        ],
    ];

    return $options;
}

/**
 * Verify a WebAuthn registration response.
 *
 * @param  PDO    $db
 * @param  int    $userId
 * @param  string $clientDataJSON   Base64URL-encoded clientDataJSON
 * @param  string $attestationObject Base64URL-encoded attestationObject
 * @param  int    $challengeId      Challenge row ID from register-options
 * @return array  Extracted credential data (credentialId, publicKeyPem)
 */
function webauthnVerifyRegistration(
    PDO    $db,
    int    $userId,
    string $clientDataJSON,
    string $attestationObject,
    int    $challengeId
): array {
    // 1. Retrieve and validate the stored challenge
    $stmt = $db->prepare(
        "SELECT challenge, user_id, type FROM webauthn_challenges
         WHERE id = ? AND expires_at > NOW()"
    );
    $stmt->execute([$challengeId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$row) {
        throw new RuntimeException('Challenge not found or expired');
    }
    if ($row['type'] !== 'register') {
        throw new RuntimeException('Invalid challenge type');
    }
    if ((int)$row['user_id'] !== $userId) {
        throw new RuntimeException('Challenge does not belong to this user');
    }

    $expectedChallenge = $row['challenge'];

    // Delete the challenge (single-use)
    $stmt = $db->prepare("DELETE FROM webauthn_challenges WHERE id = ?");
    $stmt->execute([$challengeId]);

    // 2. Decode and validate clientDataJSON
    $clientDataRaw = webauthnBase64UrlDecode($clientDataJSON);
    $clientData = json_decode($clientDataRaw, true);

    if (!$clientData) {
        throw new RuntimeException('Invalid clientDataJSON');
    }
    if (($clientData['type'] ?? '') !== 'webauthn.create') {
        throw new RuntimeException('clientData type must be webauthn.create');
    }
    if (($clientData['challenge'] ?? '') !== $expectedChallenge) {
        throw new RuntimeException('Challenge mismatch');
    }
    if (($clientData['origin'] ?? '') !== WEBAUTHN_ORIGIN) {
        throw new RuntimeException('Origin mismatch');
    }

    // 3. Decode the attestation object (CBOR)
    $attestRaw = webauthnBase64UrlDecode($attestationObject);
    $attestation = CborDecoder::decode($attestRaw);

    if (!is_array($attestation) || !isset($attestation['authData'])) {
        throw new RuntimeException('Invalid attestation object');
    }

    // 4. Parse authenticator data
    $authData = parseAuthenticatorData($attestation['authData']);

    // Verify RP ID hash
    $expectedRpIdHash = hash('sha256', WEBAUTHN_RP_ID, true);
    if (!hash_equals($expectedRpIdHash, $authData['rpIdHash'])) {
        throw new RuntimeException('RP ID hash mismatch');
    }

    // Verify User Present flag
    if (!$authData['flags']['UP']) {
        throw new RuntimeException('User not present');
    }

    // 5. Extract attested credential data
    if (!isset($authData['attestedCredentialData'])) {
        throw new RuntimeException('No attested credential data in authenticator data');
    }

    $credData     = $authData['attestedCredentialData'];
    $credentialId = webauthnBase64UrlEncode($credData['credentialId']);
    $publicKeyPem = coseKeyToPem($credData['coseKey']);
    $aaguid       = bin2hex($credData['aaguid']);

    return [
        'credentialId'   => $credentialId,
        'publicKeyPem'   => $publicKeyPem,
        'aaguid'         => $aaguid,
        'signCount'      => $authData['signCount'],
        'backupEligible' => $authData['flags']['BE'],
        'backupState'    => $authData['flags']['BS'],
    ];
}

/**
 * Generate WebAuthn authentication options (PublicKeyCredentialRequestOptions).
 * This is called without authentication — any user can initiate passkey login.
 *
 * @param  PDO   $db
 * @return array Options to pass to navigator.credentials.get()
 */
function webauthnAuthOptions(PDO $db): array {
    // Generate a random challenge (32 bytes)
    $challenge = random_bytes(32);
    $challengeB64 = webauthnBase64UrlEncode($challenge);

    // Store challenge in DB with 5-minute expiry (no user_id — discoverable flow)
    $stmt = $db->prepare(
        "INSERT INTO webauthn_challenges (challenge, user_id, type, expires_at)
         VALUES (?, NULL, 'authenticate', DATE_ADD(NOW(), INTERVAL 5 MINUTE))"
    );
    $stmt->execute([$challengeB64]);
    $challengeId = (int)$db->lastInsertId();

    $options = [
        'challengeId' => $challengeId,
        'publicKey'   => [
            'rpId'              => WEBAUTHN_RP_ID,
            'challenge'         => $challengeB64,
            'timeout'           => 60000,
            'userVerification'  => 'preferred',
            'allowCredentials'  => [],
        ],
    ];

    return $options;
}

/**
 * Verify a WebAuthn authentication assertion.
 *
 * @param  PDO    $db
 * @param  string $clientDataJSON    Base64URL-encoded clientDataJSON
 * @param  string $authenticatorData Base64URL-encoded authenticatorData
 * @param  string $signature         Base64URL-encoded signature
 * @param  int    $challengeId       Challenge row ID from auth-options
 * @param  string $credentialId      Base64URL-encoded credential ID
 * @return array  User data and JWT token
 */
function webauthnVerifyAuth(
    PDO    $db,
    string $clientDataJSON,
    string $authenticatorData,
    string $signature,
    int    $challengeId,
    string $credentialId
): array {
    // 1. Retrieve and validate the stored challenge
    $stmt = $db->prepare(
        "SELECT challenge, type FROM webauthn_challenges
         WHERE id = ? AND expires_at > NOW()"
    );
    $stmt->execute([$challengeId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$row) {
        throw new RuntimeException('Challenge not found or expired');
    }
    if ($row['type'] !== 'authenticate') {
        throw new RuntimeException('Invalid challenge type');
    }

    $expectedChallenge = $row['challenge'];

    // Delete the challenge (single-use)
    $stmt = $db->prepare("DELETE FROM webauthn_challenges WHERE id = ?");
    $stmt->execute([$challengeId]);

    // 2. Look up the stored credential
    $stmt = $db->prepare(
        "SELECT wc.user_id, wc.public_key, wc.sign_count, wc.credential_id,
                u.id, u.username, u.email, u.role, u.is_active
         FROM user_credentials_webauthn wc
         JOIN users u ON u.id = wc.user_id
         WHERE wc.credential_id = ?"
    );
    $stmt->execute([$credentialId]);
    $cred = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$cred) {
        throw new RuntimeException('Credential not found');
    }
    if (!$cred['is_active']) {
        throw new RuntimeException('Account has been deactivated');
    }

    // 3. Decode and validate clientDataJSON
    $clientDataRaw = webauthnBase64UrlDecode($clientDataJSON);
    $clientData = json_decode($clientDataRaw, true);

    if (!$clientData) {
        throw new RuntimeException('Invalid clientDataJSON');
    }
    if (($clientData['type'] ?? '') !== 'webauthn.get') {
        throw new RuntimeException('clientData type must be webauthn.get');
    }
    if (($clientData['challenge'] ?? '') !== $expectedChallenge) {
        throw new RuntimeException('Challenge mismatch');
    }
    if (($clientData['origin'] ?? '') !== WEBAUTHN_ORIGIN) {
        throw new RuntimeException('Origin mismatch');
    }

    // 4. Parse authenticator data
    $authDataRaw = webauthnBase64UrlDecode($authenticatorData);
    $authData = parseAuthenticatorData($authDataRaw);

    // Verify RP ID hash
    $expectedRpIdHash = hash('sha256', WEBAUTHN_RP_ID, true);
    if (!hash_equals($expectedRpIdHash, $authData['rpIdHash'])) {
        throw new RuntimeException('RP ID hash mismatch');
    }

    // Verify User Present flag
    if (!$authData['flags']['UP']) {
        throw new RuntimeException('User not present');
    }

    // 5. Verify the signature
    // Signature is over: authenticatorData || SHA-256(clientDataJSON)
    $clientDataHash = hash('sha256', $clientDataRaw, true);
    $signedData = $authDataRaw . $clientDataHash;

    $publicKey = openssl_pkey_get_public($cred['public_key']);
    if (!$publicKey) {
        throw new RuntimeException('Failed to load stored public key');
    }

    $sigRaw = webauthnBase64UrlDecode($signature);
    $verified = openssl_verify($signedData, $sigRaw, $publicKey, OPENSSL_ALGO_SHA256);

    if ($verified !== 1) {
        throw new RuntimeException('Signature verification failed');
    }

    // 6. Check and update sign count (replay protection)
    $storedSignCount = (int)$cred['sign_count'];
    $newSignCount    = $authData['signCount'];

    if ($newSignCount !== 0 && $newSignCount <= $storedSignCount) {
        throw new RuntimeException('Sign count regression detected — possible cloned authenticator');
    }

    // Update sign count and last_used_at
    $stmt = $db->prepare(
        "UPDATE user_credentials_webauthn
         SET sign_count = ?, last_used_at = NOW()
         WHERE credential_id = ?"
    );
    $stmt->execute([$newSignCount, $credentialId]);

    // 7. Generate JWT token
    $user = [
        'id'       => (int)$cred['user_id'],
        'username' => $cred['username'],
        'email'    => $cred['email'],
        'role'     => $cred['role'],
    ];

    require_once __DIR__ . '/Auth.php';
    $token = Auth::generateToken($user);
    Auth::setAuthCookie($token);

    return [
        'user'       => $user,
        'expires_in' => JWT_EXPIRY,
    ];
}
