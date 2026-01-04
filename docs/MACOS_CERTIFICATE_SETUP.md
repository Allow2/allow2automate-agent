# macOS Code Signing Certificate Setup Guide

This guide explains how to export and configure your Apple Developer certificates for the GitHub Actions release workflow.

## Overview

The macOS release process requires **TWO** different Apple Developer certificates:

1. **Developer ID Application** - For signing the binary executable
2. **Developer ID Installer** - For signing the PKG installer package

Both certificates must be exported and configured as GitHub secrets.

---

## Prerequisites

- Active Apple Developer account
- Certificates already installed in your Mac's Keychain Access
- Access to GitHub repository settings

---

## Step 1: Export Developer ID Application Certificate

This certificate is used to sign the binary executable (`allow2automate-agent-macos`).

### 1.1 Find the Certificate

```bash
# List all code signing identities
security find-identity -v -p codesigning

# Look for a line like:
# 1) ABC123... "Developer ID Application: Your Company Name (TEAM_ID)"
```

### 1.2 Export to .p12 File

**Option A: Using Keychain Access (GUI)**

1. Open **Keychain Access** app
2. Select **login** keychain
3. Select **My Certificates** category
4. Find **Developer ID Application: Your Company Name**
5. Right-click → **Export "Developer ID Application..."**
6. Save as: `application_cert.p12`
7. Enter a password (you'll need this for GitHub secrets)
8. Enter your Mac password to allow export

**Option B: Using Command Line**

```bash
# Export the certificate (replace with your actual identity name)
security find-identity -v -p codesigning | grep "Developer ID Application"

security export -k login.keychain \
  -t identities \
  -f pkcs12 \
  -P "YourPassword123" \
  -o application_cert.p12 \
  "Developer ID Application: Your Company Name (TEAM_ID)"
```

### 1.3 Verify the Export

```bash
# Check the certificate contains both cert and private key
openssl pkcs12 -in application_cert.p12 -info -nodes -passin pass:YourPassword123

# You should see:
# - "BEGIN CERTIFICATE" section
# - "BEGIN PRIVATE KEY" section
# - Subject: CN=Developer ID Application: Your Company Name...
```

### 1.4 Convert to Base64

```bash
# macOS
base64 -i application_cert.p12 | pbcopy

# Linux
base64 -w 0 application_cert.p12 | xclip -selection clipboard
```

The base64 string is now in your clipboard.

---

## Step 2: Export Developer ID Installer Certificate

This certificate is used to sign the PKG installer package.

### 2.1 Find the Certificate

```bash
# List all code signing identities
security find-identity -v -p codesigning

# Look for a line like:
# 2) XYZ789... "Developer ID Installer: Your Company Name (TEAM_ID)"
```

### 2.2 Export to .p12 File

**Option A: Using Keychain Access (GUI)**

1. Open **Keychain Access** app
2. Select **login** keychain
3. Select **My Certificates** category
4. Find **Developer ID Installer: Your Company Name**
5. Right-click → **Export "Developer ID Installer..."**
6. Save as: `installer_cert.p12`
7. Enter a password (same as application cert for simplicity)
8. Enter your Mac password to allow export

**Option B: Using Command Line**

```bash
# Export the certificate
security export -k login.keychain \
  -t identities \
  -f pkcs12 \
  -P "YourPassword123" \
  -o installer_cert.p12 \
  "Developer ID Installer: Your Company Name (TEAM_ID)"
```

### 2.3 Verify the Export

```bash
# Check the certificate
openssl pkcs12 -in installer_cert.p12 -info -nodes -passin pass:YourPassword123

# You should see:
# - Subject: CN=Developer ID Installer: Your Company Name...
```

### 2.4 Convert to Base64

```bash
# macOS
base64 -i installer_cert.p12 | pbcopy

# Linux
base64 -w 0 installer_cert.p12 | xclip -selection clipboard
```

---

## Step 3: Configure GitHub Secrets

### 3.1 Navigate to Repository Settings

1. Go to your GitHub repository
2. Click **Settings** tab
3. Click **Secrets and variables** → **Actions**
4. Click **New repository secret**

### 3.2 Add Certificate Secrets

Add **THREE** secrets:

**Secret 1: APPLE_APP_CERT_BASE64**
- Name: `APPLE_APP_CERT_BASE64`
- Value: [Paste base64 from Step 1.4]
- Description: Developer ID Application certificate for signing binaries

**Secret 2: APPLE_INSTALLER_CERT_BASE64**
- Name: `APPLE_INSTALLER_CERT_BASE64`
- Value: [Paste base64 from Step 2.4]
- Description: Developer ID Installer certificate for signing PKG

**Secret 3: APPLE_CERT_PASSWORD**
- Name: `APPLE_CERT_PASSWORD`
- Value: [The password you used when exporting]
- Description: Password for both .p12 certificate files

### 3.3 Optional: Notarization Secrets

For full notarization (recommended for distribution), add these additional secrets:

**Secret 4: APPLE_ID**
- Name: `APPLE_ID`
- Value: Your Apple ID email (e.g., developer@yourcompany.com)

**Secret 5: APPLE_NOTARIZATION_PASSWORD**
- Name: `APPLE_NOTARIZATION_PASSWORD`
- Value: App-specific password (see Step 4)

**Secret 6: APPLE_TEAM_ID**
- Name: `APPLE_TEAM_ID`
- Value: Your 10-character Team ID (e.g., ABC1234567)

---

## Step 4: Generate App-Specific Password (For Notarization)

Notarization requires an app-specific password, not your main Apple ID password.

### 4.1 Create App-Specific Password

1. Go to https://appleid.apple.com/
2. Sign in with your Apple ID
3. Go to **Security** section
4. Under **App-Specific Passwords**, click **Generate password**
5. Label: "GitHub Actions Notarization"
6. Copy the generated password (format: `xxxx-xxxx-xxxx-xxxx`)
7. Save this as the `APPLE_NOTARIZATION_PASSWORD` secret

### 4.2 Find Your Team ID

```bash
# List your developer teams
xcrun altool --list-providers -u "your-apple-id@example.com" -p "app-specific-password"

# Or find it in your certificate
security find-identity -v -p codesigning | grep "Developer ID"
# The Team ID is in parentheses: (ABC1234567)
```

---

## Step 5: Test the Setup

### 5.1 Trigger a Release

```bash
# Create and push a new tag
git tag v1.0.11
git push origin v1.0.11
```

### 5.2 Monitor the Workflow

1. Go to GitHub → **Actions** tab
2. Watch the **Release** workflow
3. Check the "Import Apple certificates" step
4. Look for these success messages:
   ```
   ✅ Developer ID Application certificate imported
   ✅ Developer ID Installer certificate imported
   Found 1 Application identity(ies)
   Found 1 Installer identity(ies)
   ✅ Certificate import complete
   ```

### 5.3 Verify Signing

After the workflow completes, download the PKG and verify:

```bash
# Download the PKG from the release
curl -LO https://github.com/Allow2/allow2automate-agent/releases/download/v1.0.11/allow2automate-agent-darwin-x64-v1.0.11.pkg

# Check PKG signature
pkgutil --check-signature allow2automate-agent-darwin-x64-v1.0.11.pkg

# You should see:
# Status: signed by a developer certificate issued by Apple
```

---

## Troubleshooting

### Problem: "No valid signing identities found"

**Solution**: Check that your certificates are not expired:

```bash
# Check certificate expiration
security find-certificate -c "Developer ID Application" -p | openssl x509 -noout -dates
security find-certificate -c "Developer ID Installer" -p | openssl x509 -noout -dates
```

### Problem: "Wrong certificate type detected"

**Solution**: Make sure you exported the correct certificate type:
- Application cert should have OID: `1.2.840.113635.100.6.1.13`
- Installer cert should have OID: `1.2.840.113635.100.4.13`

```bash
# Check certificate type
openssl pkcs12 -in application_cert.p12 -nokeys -passin pass:YourPassword123 | \
  openssl x509 -noout -ext extendedKeyUsage
```

### Problem: "Notarization failed"

**Solution**: Check the notarization log in GitHub Actions output. Common issues:
- Binary not signed with hardened runtime
- Unsigned dependencies
- Incorrect Team ID
- Expired app-specific password

---

## Security Best Practices

1. **Never commit .p12 files** to your repository
2. **Use strong passwords** for .p12 exports
3. **Rotate app-specific passwords** annually
4. **Limit access** to GitHub secrets to necessary team members
5. **Delete local .p12 files** after uploading to GitHub:
   ```bash
   # Securely delete certificate files
   srm application_cert.p12 installer_cert.p12  # macOS
   shred -u application_cert.p12 installer_cert.p12  # Linux
   ```

---

## Certificate Types Reference

| Certificate Type | Purpose | Used By | OID |
|-----------------|---------|---------|-----|
| Developer ID Application | Sign binaries, .app bundles | `codesign` | 1.2.840.113635.100.6.1.13 |
| Developer ID Installer | Sign PKG installers | `productsign` | 1.2.840.113635.100.4.13 |

---

## Additional Resources

- [Apple Code Signing Guide](https://developer.apple.com/library/archive/documentation/Security/Conceptual/CodeSigningGuide/)
- [Notarization Documentation](https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution)
- [GitHub Actions Secrets](https://docs.github.com/en/actions/security-guides/encrypted-secrets)

---

**Last Updated**: January 2026
