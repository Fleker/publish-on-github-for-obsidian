import { LogNotice as Notice } from './utils';
import { exec as execCb } from 'child_process';
import * as path from 'path';
import { promises as fs, existsSync } from 'fs';
import { promisify } from 'util';

const exec = promisify(execCb);

export class GitService {
  constructor(private getSettings: () => { useWsl: boolean; mainBranch: string }) {}

  // Execute shell command with support for optional WSL wrapping
  async runCommand(cmd: string, dir: string): Promise<string> {
    const settings = this.getSettings();
    if (settings.useWsl) {
      // WSL natively inherits and translates the host working directory (cwd) automatically!
      // By running "wsl <cmd>" with host cwd set, WSL executes the command natively inside
      // the translated directory (e.g. /mnt/c/Users/...). This eliminates single-quote wrapping errors on Windows.
      const wslCmd = `wsl ${cmd}`;
      const result = await exec(wslCmd, { cwd: dir, maxBuffer: 10 * 1024 * 1024 });
      return String(result.stdout);
    } else {
      const result = await exec(cmd, { cwd: dir, maxBuffer: 10 * 1024 * 1024 });
      return String(result.stdout);
    }
  }

  // Ensure git repo is initialized/cloned in localRepoPath with absolute vault safety check
  async checkAndInitGitRepo(repoPath: string, remoteUrl: string, vaultPath?: string): Promise<boolean> {
    const settings = this.getSettings();
    if (!repoPath) {
      new Notice("Error: Local Repository Path is not configured in settings.");
      return false;
    }
    if (!remoteUrl) {
      new Notice("Error: Remote Git Repository URL is not configured in settings.");
      return false;
    }

    // Critical Safety Check: Ensure the local repository folder is not within the vault
    if (vaultPath) {
      const normRepoPath = path.resolve(repoPath);
      const normVaultPath = path.resolve(vaultPath);
      if (
        normRepoPath === normVaultPath ||
        normRepoPath.startsWith(normVaultPath + path.sep) ||
        normVaultPath.startsWith(normRepoPath + path.sep)
      ) {
        new Notice("❌ CRITICAL SAFETY ERROR: Your Local Repository Path cannot be inside or equal to your Obsidian Vault path! Please configure a separate external folder.");
        return false;
      }
    }

    try {
      if (!existsSync(repoPath)) {
        await fs.mkdir(repoPath, { recursive: true });
      }

      const hasGit = existsSync(path.join(repoPath, '.git'));
      if (!hasGit) {
        new Notice("Local repo not cloned. Attempting clone...");
        try {
          if (settings.useWsl) {
            // Run clone using WSL by invoking it in the parent directory and targeting the folder name
            const parentDir = path.dirname(repoPath);
            const folderName = path.basename(repoPath);
            if (!existsSync(parentDir)) {
              await fs.mkdir(parentDir, { recursive: true });
            }
            await exec(`wsl git clone "${remoteUrl}" "${folderName}"`, { cwd: parentDir });
          } else {
            await exec(`git clone "${remoteUrl}" "${repoPath}"`);
          }
          new Notice("Repository cloned successfully!");
        } catch (_cloneErr) {
          // If clone fails (e.g. non-empty directory or empty repo), initialize locally
          try {
            await this.runCommand("git init", repoPath);
            // Try to add remote, or set url if origin already exists
            try {
              await this.runCommand(`git remote add origin "${remoteUrl}"`, repoPath);
            } catch {
              await this.runCommand(`git remote set-url origin "${remoteUrl}"`, repoPath);
            }

            // Try checking out the branch safely
            try {
              await this.runCommand(`git checkout -b "${settings.mainBranch}"`, repoPath);
            } catch {
              // Branch checkout ignored
            }
            new Notice("Associated local folder with Git repository origin successfully!");
          } catch (fallbackErr: unknown) {
            const message = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
            new Notice("Failed to initialize repository: " + message);
            return false;
          }
        }
      }
      return true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      new Notice("Git Initialization Error: " + message);
      return false;
    }
  }

  // Gather status and perform stage, commit & push
  async commitAndPush(
    repoPath: string,
    added: string[],
    modified: string[],
    deleted: string[]
  ): Promise<void> {
    const settings = this.getSettings();

    await this.runCommand("git add -A", repoPath);

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const dateTimeStr = `${year}-${month}-${day} ${hours}:${minutes}`;

    const commitTitle = `Publish [${dateTimeStr}]: +${added.length} ~${modified.length} -${deleted.length}`;
    let commitBody = `Detailed Site Changes:\n`;

    if (added.length > 0) {
      commitBody += `\nAdded:\n` + added.map(f => `  - ${f}`).join('\n');
    }
    if (modified.length > 0) {
      commitBody += `\nModified:\n` + modified.map(f => `  - ${f}`).join('\n');
    }
    if (deleted.length > 0) {
      commitBody += `\nRemoved:\n` + deleted.map(f => `  - ${f}`).join('\n');
    }

    const fullCommitMsg = `${commitTitle}\n\n${commitBody}`;
    const msgFilePath = path.join(repoPath, 'commit-msg.txt');
    await fs.writeFile(msgFilePath, fullCommitMsg, 'utf8');

    await this.runCommand(`git commit -F commit-msg.txt`, repoPath);

    if (existsSync(msgFilePath)) {
      await fs.rm(msgFilePath, { force: true });
    }

    await this.runCommand(`git push origin ${settings.mainBranch}`, repoPath);
  }
}
