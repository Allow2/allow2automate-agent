# Future Features

This document outlines planned features for the Allow2 Automate Agent.

## Local Toast/Alert Notifications

**Status**: ✅ IMPLEMENTED (User Helper v1.0)

**Description**:
The agent now includes a user-space helper application that displays toast-style notifications and system tray status. The helper runs in the user's session and communicates with the main agent service via localhost HTTP.

### Use Cases

1. **Warning Notifications**: Notify the user when they approach a screen time limit
   - "You have 10 minutes remaining"
   - "Your allowed time will end at 8:00 PM"

2. **Policy Enforcement**: Explain why a process was terminated
   - "Fortnite has been closed because your allowed time has ended"
   - "This game is blocked until homework time is complete"

3. **Connection Status**: Inform user about agent connectivity
   - "Connected to Allow2 parent controls"
   - "Unable to reach parent server - running in offline mode"

4. **System Messages**: Display important system information
   - "Allow2 Agent update installed"
   - "Policy changes have been applied"

### Technical Design Goals

1. **Non-Intrusive**: Notifications should be informative but not disruptive
2. **Platform Native**: Use OS-native notification systems when available
   - macOS: NSUserNotification or UNNotification
   - Windows: Toast notifications via Windows.UI.Notifications
   - Linux: libnotify / desktop notifications

3. **Customizable**: Parents can configure:
   - Notification verbosity levels
   - Which events trigger notifications
   - Visual appearance (if supported by OS)

4. **User-Friendly**: Messages should be:
   - Clear and age-appropriate
   - Actionable when possible
   - Respectful and non-patronizing

### Implementation

The notification system is implemented via the **Agent Helper** (`helper/` directory):

**Components:**
- `TrayManager.js` - System tray icon with status colors (green/yellow/red)
- `NotificationManager.js` - Desktop notifications using `node-notifier`
- `AgentMonitor.js` - Polls main agent at `/api/helper/status`

**Currently Implemented:**
- ✅ System tray icon with connection status
- ✅ Desktop notifications for connection changes
- ✅ Status viewing and issue reporting
- ✅ Automatic startup on user login
- ✅ Cross-platform support (macOS, Linux, Windows)

**Future Enhancements:**
- Message templating system for policy violations
- Parent-configurable notification preferences
- Respect for OS do-not-disturb/focus modes
- Localization support for multiple languages
- Time warning notifications (e.g., "10 minutes remaining")
- Process termination explanations

---

## Dynamic Child Detection

**Status**: Planned for implementation

**Description**:
The agent will run platform-specific scripts to detect which child account is currently active on the device, enabling automatic child-to-agent association without manual configuration.

### Detection Methods

1. **Windows**:
   - Check currently logged-in Windows user account
   - Parse Steam/Epic Games local config for signed-in username
   - Read browser profiles for gaming platform logins

2. **macOS**:
   - Check current macOS user session
   - Parse Steam preferences
   - Read game platform login states

3. **Linux**:
   - Check active user session (via `who` or `loginctl`)
   - Parse Steam/game configs from home directory
   - Check desktop environment session information

### Priority System

When multiple child detection sources are available:

1. **Script Detection** (highest priority): Child detected via platform scripts
2. **Default Child**: Parent-assigned default child for this agent
3. **No Child** (lowest priority): No enforcement if child cannot be determined

### Security Considerations

- Detection scripts run with limited permissions
- Results are sent to parent server for validation/approval
- Parent can review and approve/reject automatic associations
- All detection activity is logged for parental review

---

## Other Planned Features

### Multi-Profile Support
Allow a single agent to monitor multiple children by switching contexts based on logged-in user.

### Offline Mode Enhancements
Improved policy enforcement when agent cannot reach parent server, with sync reconciliation when connection is restored.

### Advanced Process Monitoring
- Detect processes launched in containers/VMs
- Monitor web-based games in browsers
- Track time spent in specific applications

### Reporting & Analytics
- Detailed usage reports sent to parent
- Trend analysis for screen time patterns
- Application usage breakdowns

---

**Last Updated**: January 2026
