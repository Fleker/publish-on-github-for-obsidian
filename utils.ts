import { Notice } from 'obsidian';

export class LogNotice extends Notice {
  constructor(message: string, duration?: number) {
    super(message, duration);
  }

  setMessage(message: string): this {
    super.setMessage(message);
    return this;
  }
}
