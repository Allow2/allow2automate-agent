# GitHub Secrets Documentation

This document describes all the secrets required for the CI/CD workflows in this repository.

## Required Secrets

### Windows Code Signing

#### `WINDOWS_CERT_BASE64`
- **Description**: Base64-encoded Windows Authenticode certificate (PFX/P12 format)
- **Required for**: Signing Windows MSI installers
- **How to generate**:
  ```bash
  base64 -w 0 your-certificate.pfx > certificate.txt
  ```
- **Used in**: `release.yml` workflow

#### `WINDOWS_CERT_PASSWORD`
- **Description**: Password for the Windows certificate
- **Required for**: Unlocking the certificate for signing
- **Used in**: `release.yml` workflow

### macOS Code Signing & Notarization

#### `APPLE_CERT_BASE64`
- **Description**: Base64-encoded Apple Developer ID certificate (P12 format)
- **Required for**: Signing macOS PKG installers
- **How to generate**:
  ```bash
  base64 -w 0 your-apple-cert.p12 > apple-cert.txt
  ```
- **Used in**: `release.yml` workflow

#### `APPLE_CERT_PASSWORD`
- **Description**: Password for the Apple Developer certificate
- **Required for**: Unlocking the certificate for signing
- **Used in**: `release.yml` workflow

#### `APPLE_ID`
- **Description**: Your Apple ID email address
- **Required for**: Notarizing macOS applications
- **Format**: `developer@example.com`
- **Used in**: `release.yml` workflow

#### `APPLE_NOTARIZATION_PASSWORD`
- **Description**: App-specific password for notarization
- **Required for**: Submitting apps to Apple's notarization service
- **How to generate**: Create at https://appleid.apple.com/account/manage → Security → App-Specific Passwords
- **Used in**: `release.yml` workflow

#### `APPLE_TEAM_ID`
- **Description**: Your Apple Developer Team ID
- **Required for**: Notarization process
- **Format**: 10-character alphanumeric (e.g., `ABCD123456`)
- **Where to find**: https://developer.apple.com/account → Membership Details
- **Used in**: `release.yml` workflow

#### `APPLE_DEVELOPER_ID`
- **Description**: Your Developer ID certificate name
- **Required for**: Code signing on macOS
- **Format**: `Developer ID Installer: Your Name (TEAM_ID)`
- **How to find**:
  ```bash
  security find-identity -v -p codesigning
  ```
- **Used in**: `release.yml` workflow

### Linux Package Signing

#### `GPG_PRIVATE_KEY`
- **Description**: GPG private key for signing Linux packages
- **Required for**: Signing DEB and RPM packages
- **How to generate**:
  ```bash
  gpg --full-generate-key
  gpg --armor --export-secret-keys YOUR_KEY_ID > private-key.asc
  ```
- **Used in**: `release.yml` workflow

#### `GPG_PASSPHRASE`
- **Description**: Passphrase for the GPG private key
- **Required for**: Unlocking the GPG key for signing
- **Used in**: `release.yml` workflow

#### `GPG_KEY_ID`
- **Description**: GPG key ID (fingerprint or long ID)
- **Required for**: Identifying which key to use for signing
- **Format**: 16 or 40 character hexadecimal
- **How to find**:
  ```bash
  gpg --list-secret-keys --keyid-format=long
  ```
- **Used in**: `release.yml` workflow

### Code Coverage

#### `CODECOV_TOKEN`
- **Description**: Token for uploading coverage reports to Codecov
- **Required for**: Code coverage tracking
- **How to get**: Sign up at https://codecov.io and get token for your repository
- **Used in**: `build.yml` workflow
- **Note**: Optional - workflow will continue if not set

## Setting Up Secrets

### Via GitHub Web Interface

1. Navigate to your repository on GitHub
2. Go to **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Enter the secret name and value
5. Click **Add secret**

### Via GitHub CLI

```bash
gh secret set WINDOWS_CERT_BASE64 < certificate.txt
gh secret set WINDOWS_CERT_PASSWORD --body "your-password"
gh secret set APPLE_ID --body "developer@example.com"
# ... repeat for all secrets
```

## Security Best Practices

1. **Never commit secrets** to the repository
2. **Rotate secrets regularly** (at least annually)
3. **Use separate certificates** for different environments (dev/staging/prod)
4. **Limit secret access** to only necessary workflows
5. **Monitor secret usage** in workflow run logs
6. **Revoke compromised secrets** immediately

## Conditional Signing

The workflows are designed to work even without secrets:

- If signing secrets are not available, installers will be built but not signed
- The workflow will continue and create unsigned releases
- This allows testing the build process without requiring certificates

To enable signing, simply add the relevant secrets to your repository.

## Testing Secrets Locally

⚠️ **NEVER** test with production secrets locally!

For local testing:

1. Create test certificates (self-signed for Windows/macOS, test GPG key for Linux)
2. Use environment variables instead of GitHub secrets
3. Test the signing process with test certificates
4. Verify signatures work before using production secrets

## Secret Rotation Schedule

| Secret Type | Rotation Frequency | Next Rotation |
|------------|-------------------|---------------|
| Code Signing Certs | Annually | Based on cert expiry |
| GPG Keys | Every 2 years | Based on key expiry |
| API Tokens | Every 6 months | Manual |

## Support

For issues with secrets or signing:

1. Check workflow logs for error messages
2. Verify secret names match exactly (case-sensitive)
3. Ensure certificates are valid and not expired
4. Consult platform-specific signing documentation:
   - Windows: https://docs.microsoft.com/en-us/windows/win32/seccrypto/cryptography-tools
   - macOS: https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution
   - Linux: https://wiki.debian.org/DebianRepository/UseThirdParty

## Required Secrets Summary

| Secret Name | Platform | Required | Workflow |
|-------------|----------|----------|----------|
| WINDOWS_CERT_BASE64 | Windows | No* | release.yml |
| WINDOWS_CERT_PASSWORD | Windows | No* | release.yml |
| APPLE_CERT_BASE64 | macOS | No* | release.yml |
| APPLE_CERT_PASSWORD | macOS | No* | release.yml |
| APPLE_ID | macOS | No* | release.yml |
| APPLE_NOTARIZATION_PASSWORD | macOS | No* | release.yml |
| APPLE_TEAM_ID | macOS | No* | release.yml |
| APPLE_DEVELOPER_ID | macOS | No* | release.yml |
| GPG_PRIVATE_KEY | Linux | No* | release.yml |
| GPG_PASSPHRASE | Linux | No* | release.yml |
| GPG_KEY_ID | Linux | No* | release.yml |
| CODECOV_TOKEN | All | No | build.yml |

\* Not strictly required - workflows will build unsigned installers if secrets are missing.
