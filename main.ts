import {
  App,
  Plugin,
  PluginSettingTab,
  Setting,
  SettingDefinitionItem,
  TFile,
  FileSystemAdapter
} from 'obsidian';
import * as path from 'path';
import { promises as fs, existsSync } from 'fs';

import { LogNotice as Notice } from './utils';
import { GitService } from './git-service';
import { ThemeService } from './theme-service';

interface PublishSettings {
  publishTag: string;
  localRepoPath: string;
  remoteRepoUrl: string;
  mainBranch: string;
  useWsl: boolean;
  githubRepo: string; // e.g. "username/repo"
  siteTitle: string;
  siteSubtitle: string;
  stripObsidianComments: boolean;
  stripPrivateCallouts: boolean;
  privateCalloutTags: string;
}

const DEFAULT_SETTINGS: PublishSettings = {
  publishTag: '#public',
  localRepoPath: '',
  remoteRepoUrl: '',
  mainBranch: 'main',
  useWsl: false,
  githubRepo: '',
  siteTitle: 'My Public Notes',
  siteSubtitle: 'Digital Garden',
  stripObsidianComments: true,
  stripPrivateCallouts: true,
  privateCalloutTags: 'private, secret, salty'
};

export default class PublishPlugin extends Plugin {
  declare settings: PublishSettings;
  gitService!: GitService;
  themeService!: ThemeService;

  async onload(): Promise<void> {
    await this.loadSettings();

    // Instantiate modular services
    this.gitService = new GitService(() => ({
      useWsl: this.settings.useWsl,
      mainBranch: this.settings.mainBranch
    }));
    this.themeService = new ThemeService();

    // Register ribbon icon
    this.addRibbonIcon('share-2', 'Publish Public Notes', () => {
      void this.publishNotes();
    });

    // Register commands
    this.addCommand({
      id: 'publish-public-notes',
      name: 'Publish Public Notes',
      callback: () => {
        void this.publishNotes();
      }
    });

    this.addCommand({
      id: 'initialize-jekyll-site',
      name: 'Initialize Jekyll Theme Templates',
      callback: () => {
        void this.initializeJekyllTheme();
      }
    });

    this.addCommand({
      id: 'reset-local-repository',
      name: 'Reset Local Git Repository',
      callback: () => {
        void this.resetLocalRepo();
      }
    });

    // Add settings tab
    this.addSettingTab(new PublishSettingTab(this.app, this));
  }

  async loadSettings(): Promise<void> {
    const loadedData = (await this.loadData()) as Partial<PublishSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData ?? {});
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  // Wrapper for theme initialization
  async initializeJekyllTheme(): Promise<void> {
    // Parse Github username/repo from URL if not specified
    if (!this.settings.githubRepo && this.settings.remoteRepoUrl) {
      const repoUrl = this.settings.remoteRepoUrl;
      const match = repoUrl.match(/github\.com[:/]([^/]+)\/([^.]+)/);
      if (match) {
        this.settings.githubRepo = `${match[1]}/${match[2]}`;
        await this.saveSettings();
      }
    }

    await this.themeService.initializeJekyllTheme(
      this.settings.localRepoPath,
      this.settings.githubRepo,
      this.settings.mainBranch,
      this.settings.siteTitle,
      this.settings.siteSubtitle,
      this.settings.publishTag
    );
  }

  // Wipe local repository directory entirely and re-clone/reset
  async resetLocalRepo(): Promise<void> {
    const repoPath = this.settings.localRepoPath;
    if (!repoPath) {
      new Notice("Configure Local Repository Path in Settings first!");
      return;
    }

    try {
      if (existsSync(repoPath)) {
        new Notice("Wiping local directory...");
        await fs.rm(repoPath, { recursive: true, force: true });
      }
      const adapter = this.app.vault.adapter;
      const vaultPath = adapter instanceof FileSystemAdapter ? adapter.getBasePath() : '';
      const success = await this.gitService.checkAndInitGitRepo(repoPath, this.settings.remoteRepoUrl, vaultPath);
      if (success) {
        new Notice("Local Git repository wiped and re-initialized!");
        await this.initializeJekyllTheme();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      new Notice("Reset Error: " + message);
    }
  }

  // Clean out previous markdown and asset files in the repo (preserving .git, layouts, configs)
  async clearOldFiles(): Promise<void> {
    const repoPath = this.settings.localRepoPath;
    if (!existsSync(repoPath)) return;

    const files = await fs.readdir(repoPath);
    for (const file of files) {
      // Keep Git, Jekyll structure, and configuration files
      if (
        file === '.git' ||
        file === '.github' ||
        file === '_layouts' ||
        file === '_includes' ||
        file === 'assets' ||
        file === '_config.yml' ||
        file === 'Gemfile' ||
        file === 'Gemfile.lock' ||
        file === 'commit-msg.txt'
      ) {
        continue;
      }

      const fullPath = path.join(repoPath, file);
      const stat = await fs.stat(fullPath);
      if (stat.isDirectory()) {
        await fs.rm(fullPath, { recursive: true, force: true });
      } else {
        await fs.rm(fullPath, { force: true });
      }
    }
  }

  // Strip private/salty sections (Obsidian comments %%...%% and Callouts > [!private])
  stripPrivateSections(content: string): string {
    let result = content;

    // 1. Strip Obsidian Comments (%% ... %%)
    if (this.settings.stripObsidianComments) {
      result = result.replace(/%%[\s\S]*?%%/g, '');
    }

    // 2. Strip Private Callouts (> [!private] ...)
    if (this.settings.stripPrivateCallouts && this.settings.privateCalloutTags.trim()) {
      const tags = this.settings.privateCalloutTags
        .split(',')
        .map(t => t.trim().replace(/^#/, '').toLowerCase())
        .filter(Boolean);

      if (tags.length > 0) {
        const escapeRegExp = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = tags.map(escapeRegExp).join('|');
        const calloutRegex = new RegExp(`^\\s*>\\s*\\[!(${pattern})\\][^\\n]*\\n(?:\\s*>[^\\n]*\\n?)*`, 'gim');
        result = result.replace(calloutRegex, '');
      }
    }

    return result;
  }

  // Principal function to gather public files, process wikilinks, handle assets, diff, commit and push
  async publishNotes(): Promise<void> {
    const activeNotice = new Notice("Starting Publish Pipeline...", 0);

    const adapter = this.app.vault.adapter;
    const vaultPath = adapter instanceof FileSystemAdapter ? adapter.getBasePath() : '';
    const isGitReady = await this.gitService.checkAndInitGitRepo(
      this.settings.localRepoPath,
      this.settings.remoteRepoUrl,
      vaultPath
    );
    if (!isGitReady) {
      activeNotice.hide();
      return;
    }

    const tagToFind = this.settings.publishTag;
    const repoPath = this.settings.localRepoPath;

    activeNotice.setMessage("Scanning Obsidian Vault for public notes...");

    // Gather public files
    const allFiles = this.app.vault.getMarkdownFiles();
    const publicFilesSet = new Set<string>();
    const publicTFiles: TFile[] = [];

    for (const file of allFiles) {
      const cache = this.app.metadataCache.getFileCache(file);
      let isPublic = false;

      // Check inline tags
      if (cache?.tags) {
        for (const t of cache.tags) {
          if (t.tag === tagToFind) {
            isPublic = true;
            break;
          }
        }
      }

      // Check frontmatter tags
      if (!isPublic && cache?.frontmatter) {
        const frontmatter = cache.frontmatter as Record<string, unknown>;
        const tagsProp = frontmatter['tags'] ?? frontmatter['tag'];
        if (tagsProp) {
          if (Array.isArray(tagsProp)) {
            if (tagsProp.some((t: unknown) => typeof t === 'string' && (t === tagToFind.replace('#', '') || t === tagToFind))) {
              isPublic = true;
            }
          } else if (typeof tagsProp === 'string') {
            const splitTags = tagsProp.split(/[\s,]+/);
            if (splitTags.some(t => t === tagToFind.replace('#', '') || t === tagToFind)) {
              isPublic = true;
            }
          }
        }
      }

      if (isPublic) {
        publicFilesSet.add(file.path);
        publicTFiles.push(file);
      }
    }

    if (publicTFiles.length === 0) {
      activeNotice.hide();
      new Notice(`No files found with the tag "${tagToFind}"!`);
      return;
    }

    activeNotice.setMessage(`Found ${publicTFiles.length} public notes. Syncing files...`);

    try {
      // Clear old synced files
      await this.clearOldFiles();

      const brokenLinks: { source: string; target: string }[] = [];
      const referencedAssets = new Set<string>();

      // Read and process each public file
      for (const file of publicTFiles) {
        const rawContent = await this.app.vault.read(file);

        // Strip private/salty sections (comments & callouts) before frontmatter processing
        const sanitizedContent = this.stripPrivateSections(rawContent);

        // Process Frontmatter and render HTML badges
        const { processedContent } = this.processFrontmatter(sanitizedContent, file.basename);

        // Convert Wikilinks and track embedded images
        const finalContent = this.convertLinksAndEmbeds(processedContent, file, publicFilesSet, brokenLinks, referencedAssets);

        // Write to target repository preserving path tree
        const targetPath = path.join(repoPath, file.path);
        const targetDir = path.dirname(targetPath);

        if (!existsSync(targetDir)) {
          await fs.mkdir(targetDir, { recursive: true });
        }

        await fs.writeFile(targetPath, finalContent, 'utf8');
      }

      // Handle asset/image replication
      if (referencedAssets.size > 0) {
        activeNotice.setMessage(`Syncing ${referencedAssets.size} images...`);
        const targetAssetsDir = path.join(repoPath, 'assets', 'images');
        if (!existsSync(targetAssetsDir)) {
          await fs.mkdir(targetAssetsDir, { recursive: true });
        }

        const vaultAdapter = this.app.vault.adapter;
        if (vaultAdapter instanceof FileSystemAdapter) {
          const basePath = vaultAdapter.getBasePath();

          for (const assetPath of referencedAssets) {
            const fullSourcePath = path.join(basePath, assetPath);
            if (existsSync(fullSourcePath)) {
              const fileStat = await fs.stat(fullSourcePath);
              if (fileStat.isFile()) {
                const ext = path.extname(assetPath);
                const name = path.basename(assetPath, ext);
                const targetAssetPath = path.join(targetAssetsDir, `${name}${ext}`);
                await fs.copyFile(fullSourcePath, targetAssetPath);
              }
            }
          }
        }
      }

      // Ensure we have an index.md fallback in the repository root if none was copied from the vault
      await this.themeService.ensureFallbackIndex(repoPath);

      // Display warning for broken links
      if (brokenLinks.length > 0) {
        const uniqueBroken = Array.from(new Set(brokenLinks.map(b => `${path.basename(b.source)} ➔ ${path.basename(b.target)}`)));
        new Notice(`⚠️ Broken links warning! The following public notes link to private ones:\n\n${uniqueBroken.slice(0, 5).join('\n')}${uniqueBroken.length > 5 ? '\n...and more' : ''}`, 10000);
      }

      // Commit and Push via Git
      activeNotice.setMessage("Checking Git changes...");

      const porcelainStatus = await this.gitService.runCommand("git status --porcelain", repoPath);

      if (!porcelainStatus.trim()) {
        activeNotice.hide();
        new Notice("No changes detected since last publish!");
        return;
      }

      // Parse status to build detailed commit body
      const added: string[] = [];
      const modified: string[] = [];
      const deleted: string[] = [];

      const statusLines = porcelainStatus.split('\n');
      for (const line of statusLines) {
        if (!line.trim()) continue;
        const statusCode = line.substring(0, 2);
        const filePath = line.substring(3).trim().replace(/^"|"$/g, '');

        if (statusCode.includes('A') || statusCode.includes('?')) {
          added.push(filePath);
        } else if (statusCode.includes('M') || statusCode.includes('R')) {
          modified.push(filePath);
        } else if (statusCode.includes('D')) {
          deleted.push(filePath);
        }
      }

      activeNotice.setMessage(`Staging changes (Added: ${added.length}, Modified: ${modified.length}, Deleted: ${deleted.length})...`);
      
      await this.gitService.commitAndPush(repoPath, added, modified, deleted);

      activeNotice.hide();
      new Notice(`Successfully Published! Added: ${added.length}, Modified: ${modified.length}, Removed: ${deleted.length}`);
    } catch (err: unknown) {
      activeNotice.hide();
      const message = err instanceof Error ? err.message : String(err);
      new Notice("Publish Failure: " + message);
      console.error(err);
    }
  }

  // Standard Frontmatter extractor & badge pre-pender with automatic publish-tag stripping
  processFrontmatter(content: string, title: string): { processedContent: string, properties: Record<string, string> } {
    let processed = content;
    const frontmatter: Record<string, string> = {};

    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
    if (match) {
      const rawYaml = match[1];
      const lines = rawYaml.split('\n');
      for (const line of lines) {
        const colonIndex = line.indexOf(':');
        if (colonIndex > 0) {
          const key = line.substring(0, colonIndex).trim();
          const val = line.substring(colonIndex + 1).trim();
          let cleanVal = val.replace(/^["']|["']$/g, '');

          // Strip the publish tag from tags frontmatter list so it is not rendered as a badge
          if (key === 'tags' || key === 'tag') {
            const targetTag = this.settings.publishTag.replace('#', '').toLowerCase();
            const targetTagWithHash = ('#' + targetTag);
            
            const tags = cleanVal
              .replace(/^\[|\]$/g, '') // remove brackets
              .split(/[\s,]+/)         // split by comma/space
              .map(t => t.trim().toLowerCase())
              .filter(t => t && t !== targetTag && t !== targetTagWithHash);
            
            if (tags.length > 0) {
              cleanVal = `[${tags.join(', ')}]`;
            } else {
              continue; // Skip this tags property completely if it only contained the publish tag
            }
          }

          frontmatter[key] = cleanVal;
        }
      }
      processed = content.substring(match[0].length);
    }

    // Default Jekyll fields
    frontmatter['layout'] = 'default';
    frontmatter['title'] = frontmatter['title'] || title;

    // Compile yaml back for Jekyll
    let yamlStr = '---\n';
    for (const [k, v] of Object.entries(frontmatter)) {
      yamlStr += `${k}: "${v}"\n`;
    }
    yamlStr += '---\n';

    // Strip inline publish tag from body content to hide it on the web page
    const escapeRegExp = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tagToStrip = this.settings.publishTag;
    
    // 1. Strip from lines where the tag is the only content
    const emptyLineRegex = new RegExp('^\\s*' + escapeRegExp(tagToStrip) + '\\s*$', 'mg');
    let cleanBody = processed.replace(emptyLineRegex, '');
    
    // 2. Strip inline occurrences of the tag without lookbehind
    const inlineTagRegex = new RegExp('(^|\\s)' + escapeRegExp(tagToStrip) + '(\\s|[,.;!?]|$)', 'g');
    cleanBody = cleanBody.replace(inlineTagRegex, '$1$2');

    // Badge Renderer (exclude design metadata)
    const excludedProperties = ['layout', 'title', 'position', 'permalink'];
    const badges: string[] = [];
    for (const [k, v] of Object.entries(frontmatter)) {
      if (!excludedProperties.includes(k) && v) {
        badges.push(`<span class="badge badge-${k}" style="background-color: var(--badge-bg); color: var(--badge-color); border: 1px solid var(--badge-border); padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight: 500; font-family: system-ui, -apple-system, sans-serif;">${k}: ${v}</span>`);
      }
    }

    let badgesHtml = '';
    if (badges.length > 0) {
      badgesHtml = `<div class="content-badges" style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 20px;">\n  ${badges.join('\n  ')}\n</div>\n\n`;
    }

    return {
      processedContent: yamlStr + badgesHtml + cleanBody,
      properties: frontmatter
    };
  }

  // Regular expression link parser & relative route mapping
  convertLinksAndEmbeds(
    content: string,
    sourceFile: TFile,
    publicFiles: Set<string>,
    brokenLinks: { source: string; target: string }[],
    referencedAssets: Set<string>
  ): string {
    // 1. Convert embeds (e.g. images)
    let processed = content.replace(/!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (match: string, linkpath: string, label: string | undefined) => {
      const dest = this.app.metadataCache.getFirstLinkpathDest(linkpath, sourceFile.path);
      if (!dest) return match;

      const isImage = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp'].includes(dest.extension.toLowerCase());
      if (isImage) {
        const sourceDir = path.dirname(sourceFile.path);
        const depth = sourceDir === '.' ? 0 : sourceDir.split('/').length;
        let prefix = '';
        for (let i = 0; i < depth; i++) {
          prefix += '../';
        }
        const targetUrl = `${prefix}assets/images/${dest.basename}.${dest.extension}`;
        referencedAssets.add(dest.path);
        return `![${label || dest.basename}](${targetUrl})`;
      }
      return match;
    });

    // 2. Convert standard wikilinks
    processed = processed.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (match: string, linkpath: string, label: string | undefined) => {
      const dest = this.app.metadataCache.getFirstLinkpathDest(linkpath, sourceFile.path);
      if (!dest) return match;

      if (!publicFiles.has(dest.path)) {
        brokenLinks.push({ source: sourceFile.path, target: dest.path });
        return `<span class="private-link" title="This page is private" style="color: #94a3b8; cursor: not-allowed; text-decoration: dashed underline;">${label || dest.basename}</span>`;
      }

      const sourceDir = path.dirname(sourceFile.path);
      const destDir = path.dirname(dest.path);

      let relativePath = '';
      if (sourceDir === destDir) {
        relativePath = `./${dest.basename}.md`;
      } else {
        const sourceParts = sourceDir === '.' ? [] : sourceDir.split('/');
        const destParts = destDir === '.' ? [] : destDir.split('/');

        let commonCount = 0;
        while (
          commonCount < sourceParts.length &&
          commonCount < destParts.length &&
          sourceParts[commonCount] === destParts[commonCount]
        ) {
          commonCount++;
        }

        let parents = '';
        for (let i = commonCount; i < sourceParts.length; i++) {
          parents += '../';
        }

        let destSub = destParts.slice(commonCount).join('/');
        if (destSub) {
          destSub += '/';
        }

        relativePath = `${parents}${destSub}${dest.basename}.md`;
      }

      return `[${label || dest.basename}](${encodeURI(relativePath)})`;
    });

    return processed;
  }
}

// Plugin Settings Tab UI class
class PublishSettingTab extends PluginSettingTab {
  plugin: PublishPlugin;

  constructor(app: App, plugin: PublishPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        name: 'Publish tag',
        desc: 'Only notes with this tag in body or frontmatter will be published.',
      },
      {
        name: 'Site title',
        desc: 'Title of your published website (e.g. My Public Notes)',
      },
      {
        name: 'Site subtitle',
        desc: 'Subtitle/brand of your published website (e.g. Digital Garden)',
      },
      {
        name: 'Local repository path',
        desc: 'Local directory where the Git clone lives. (Use an absolute Windows path if on Windows)',
      },
      {
        name: 'Remote Git URL',
        desc: 'Your target GitHub repository clone URL.',
      },
      {
        name: 'Target branch',
        desc: 'Default branch to push files to (e.g. main or gh-pages)',
      },
      {
        name: 'GitHub repository path (optional)',
        desc: 'Format: username/repo (for content feedback links). Auto-parsed if blank.',
      },
      {
        name: 'Run Git via WSL',
        desc: 'Toggle this ON if you want the plugin to delegate Git actions to WSL bash.',
      },
      {
        name: 'Strip Obsidian comments (%%...%%)',
        desc: 'Remove all %% Obsidian comments %% before publishing notes.',
      },
      {
        name: 'Strip private callout blocks',
        desc: 'Remove callout blocks tagged with private tags (e.g. > [!private]).',
      },
      {
        name: 'Private callout tags',
        desc: 'Comma-separated list of callout tags to exclude from publishing.',
      },
      {
        name: 'Initialize Jekyll theme templates',
        desc: 'Generates index, layouts, styles, and workflows in the local repository.',
      },
      {
        name: 'Reset local repository',
        desc: '⚠️ WARNING: Deletes the entire local repository folder and performs a fresh clone and theme setup.',
      }
    ];
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Publish tag')
      .setDesc('Only notes with this tag in body or frontmatter will be published.')
      .addText(text =>
        text
          .setPlaceholder('#public')
          .setValue(this.plugin.settings.publishTag)
          .onChange(async value => {
            this.plugin.settings.publishTag = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Site title')
      .setDesc('Title of your published website (e.g. My Public Notes)')
      .addText(text =>
        text
          .setPlaceholder('My Public Notes')
          .setValue(this.plugin.settings.siteTitle)
          .onChange(async value => {
            this.plugin.settings.siteTitle = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Site subtitle')
      .setDesc('Subtitle/brand of your published website (e.g. Digital Garden)')
      .addText(text =>
        text
          .setPlaceholder('Digital Garden')
          .setValue(this.plugin.settings.siteSubtitle)
          .onChange(async value => {
            this.plugin.settings.siteSubtitle = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Local repository path')
      .setDesc('Local directory where the Git clone lives. (Use an absolute Windows path if on Windows)')
      .addText(text =>
        text
          .setPlaceholder('C:\\path\\to\\git-repo')
          .setValue(this.plugin.settings.localRepoPath)
          .onChange(async value => {
            this.plugin.settings.localRepoPath = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Remote Git URL')
      .setDesc('Your target GitHub repository clone URL.')
      .addText(text =>
        text
          .setPlaceholder('git@github.com:username/repo.git')
          .setValue(this.plugin.settings.remoteRepoUrl)
          .onChange(async value => {
            this.plugin.settings.remoteRepoUrl = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Target branch')
      .setDesc('Default branch to push files to (e.g. main or gh-pages)')
      .addText(text =>
        text
          .setPlaceholder('main')
          .setValue(this.plugin.settings.mainBranch)
          .onChange(async value => {
            this.plugin.settings.mainBranch = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('GitHub repository path (optional)')
      .setDesc('Format: username/repo (for content feedback links). Auto-parsed if blank.')
      .addText(text =>
        text
          .setPlaceholder('username/repo')
          .setValue(this.plugin.settings.githubRepo)
          .onChange(async value => {
            this.plugin.settings.githubRepo = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Run Git via WSL')
      .setDesc('Toggle this ON if you want the plugin to delegate Git actions to WSL bash.')
      .addToggle(toggle =>
        toggle
          .setValue(this.plugin.settings.useWsl)
          .onChange(async value => {
            this.plugin.settings.useWsl = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Content Filtering & Privacy')
      .setHeading();

    new Setting(containerEl)
      .setName('Strip Obsidian comments (%%...%%)')
      .setDesc('Remove all %% Obsidian comments %% before publishing notes.')
      .addToggle(toggle =>
        toggle
          .setValue(this.plugin.settings.stripObsidianComments)
          .onChange(async value => {
            this.plugin.settings.stripObsidianComments = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Strip private callout blocks')
      .setDesc('Remove callout blocks tagged with private tags (e.g. > [!private]).')
      .addToggle(toggle =>
        toggle
          .setValue(this.plugin.settings.stripPrivateCallouts)
          .onChange(async value => {
            this.plugin.settings.stripPrivateCallouts = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Private callout tags')
      .setDesc('Comma-separated list of callout tags to exclude from publishing.')
      .addText(text =>
        text
          .setPlaceholder('private, secret, salty')
          .setValue(this.plugin.settings.privateCalloutTags)
          .onChange(async value => {
            this.plugin.settings.privateCalloutTags = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Maintenance & Actions')
      .setHeading();

    new Setting(containerEl)
      .setName('Initialize Jekyll theme templates')
      .setDesc('Generates index, layouts, styles, and workflows in the local repository.')
      .addButton(cb => {
        cb.setButtonText("Initialize Theme");
        cb.onClick(() => {
          void this.plugin.initializeJekyllTheme();
        });
      });

    new Setting(containerEl)
      .setName('Reset local repository')
      .setDesc('⚠️ WARNING: Deletes the entire local repository folder and performs a fresh clone and theme setup.')
      .addButton(cb => {
        cb.setButtonText("Reset Repo");
        // cb.setDestructive();
        cb.onClick(() => {
          void this.plugin.resetLocalRepo();
        });
      });
  }
}
