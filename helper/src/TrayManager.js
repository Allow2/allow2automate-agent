/**
 * System Tray Manager
 * Manages the system tray icon and menu using systray
 */

import SysTray from 'systray';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default class TrayManager {
  constructor(callbacks = {}) {
    this.tray = null;
    this.callbacks = callbacks;
    this.currentStatus = 'disconnected';
    this.statusText = 'Initializing...';
  }

  async initialize() {
    const iconPath = this.getIconPath(this.currentStatus);

    this.tray = new SysTray({
      menu: {
        icon: iconPath,
        title: 'Allow2',
        tooltip: this.statusText,
        items: [
          {
            title: 'Status',
            tooltip: 'View agent status',
            checked: false,
            enabled: true
          },
          {
            title: 'View Issues',
            tooltip: 'View connection and configuration issues',
            checked: false,
            enabled: true
          },
          SysTray.separator,
          {
            title: 'About',
            tooltip: 'About Allow2 Agent Helper',
            checked: false,
            enabled: true
          },
          SysTray.separator,
          {
            title: 'Quit',
            tooltip: 'Exit Allow2 Agent Helper',
            checked: false,
            enabled: true
          }
        ]
      }
    });

    this.tray.onClick(action => {
      this.handleMenuClick(action);
    });

    console.log('[TrayManager] System tray icon created');
  }

  handleMenuClick(action) {
    if (!action || !action.item) return;

    const itemTitle = action.item.title;

    switch (itemTitle) {
      case 'Status':
        if (this.callbacks.onStatusClick) {
          this.callbacks.onStatusClick();
        }
        break;

      case 'View Issues':
        if (this.callbacks.onIssuesClick) {
          this.callbacks.onIssuesClick();
        }
        break;

      case 'About':
        this.showAbout();
        break;

      case 'Quit':
        if (this.callbacks.onQuit) {
          this.callbacks.onQuit();
        }
        break;
    }
  }

  setStatus(status, statusText) {
    this.currentStatus = status;
    this.statusText = statusText;

    if (this.tray) {
      // Update icon
      const iconPath = this.getIconPath(status);

      // Update menu with new status
      this.tray.sendAction({
        type: 'update-item',
        item: {
          title: 'Allow2',
          tooltip: statusText,
          icon: iconPath
        },
        seq_id: 0
      });
    }
  }

  getIconPath(status) {
    // Return base64 encoded icon data or path to icon file
    // For now, we'll use built-in icons based on status
    // In production, you'd have actual icon files in assets/

    const icons = {
      connected: this.getIconData('green'),
      warning: this.getIconData('yellow'),
      disconnected: this.getIconData('red'),
      error: this.getIconData('red')
    };

    return icons[status] || icons.disconnected;
  }

  getIconData(color) {
    // Simple colored circle SVG as base64 (platform-independent)
    // In production, replace with proper icon files
    const svg = `
      <svg width="32" height="32" xmlns="http://www.w3.org/2000/svg">
        <circle cx="16" cy="16" r="12" fill="${color === 'green' ? '#4CAF50' : color === 'yellow' ? '#FFC107' : '#F44336'}" />
        <text x="16" y="20" text-anchor="middle" fill="white" font-family="Arial" font-size="16" font-weight="bold">A2</text>
      </svg>
    `;

    // Convert to base64
    const base64 = Buffer.from(svg).toString('base64');
    return `data:image/svg+xml;base64,${base64}`;
  }

  showAbout() {
    console.log('\n=== Allow2 Agent Helper ===');
    console.log('Version: 1.0.0');
    console.log('User-space helper for Allow2 Automate Agent');
    console.log('Provides system tray status and notifications');
    console.log('\nCopyright © 2026 Allow2');
    console.log('Licensed under MIT\n');
  }

  destroy() {
    if (this.tray) {
      this.tray.kill();
      this.tray = null;
    }
  }
}
