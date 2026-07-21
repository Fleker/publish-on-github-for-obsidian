import { Notice } from 'obsidian';

export class LogNotice extends Notice {
  constructor(message: string, duration?: number) {
    super(message, duration);
    console.log(`[GitSelectivePublisher] Notice: ${message}`);
  }

  setMessage(message: string): this {
    super.setMessage(message);
    console.log(`[GitSelectivePublisher] Notice Update: ${message}`);
    return this;
  }
}
