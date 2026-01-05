/**
 * Notification Manager
 * Handles desktop notifications using node-notifier
 */

import notifier from 'node-notifier';
import path from 'path';

export default class NotificationManager {
  constructor() {
    this.notificationQueue = [];
    this.isShowing = false;
  }

  notify(options) {
    const notification = {
      title: options.title || 'Allow2 Agent',
      message: options.message || '',
      icon: this.getIconForType(options.icon || 'info'),
      sound: options.sound || false,
      wait: false,
      timeout: options.timeout || 10
    };

    // Add to queue
    this.notificationQueue.push(notification);

    // Process queue
    this.processQueue();
  }

  processQueue() {
    if (this.isShowing || this.notificationQueue.length === 0) {
      return;
    }

    this.isShowing = true;
    const notification = this.notificationQueue.shift();

    notifier.notify(notification, (err, response) => {
      if (err) {
        console.error('[NotificationManager] Error showing notification:', err);
      }

      this.isShowing = false;

      // Process next in queue after a short delay
      if (this.notificationQueue.length > 0) {
        setTimeout(() => this.processQueue(), 500);
      }
    });
  }

  getIconForType(type) {
    // Map icon types to system icons or custom paths
    // For now, return undefined to use system default
    // In production, you'd have icon files in assets/

    const iconMap = {
      success: undefined, // Use system success icon
      error: undefined,   // Use system error icon
      warning: undefined, // Use system warning icon
      info: undefined     // Use system info icon
    };

    return iconMap[type] || iconMap.info;
  }

  clearQueue() {
    this.notificationQueue = [];
  }
}
