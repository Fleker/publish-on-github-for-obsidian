# Publish on GitHub (Obsidian Plugin)

A premium Obsidian plugin that enables selective publishing of notes directly to a GitHub Pages-hosted Jekyll static site. It queries your vault, extracts notes tagged with `#public` (or a custom tag), converts Obsidian-specific wikilinks and images to relative Markdown pathways, builds stylish HTML property badges, validates links, and executes automated Git commits and pushes.

**Example**: https://felker.dev/obsidian-knowledge/

## 🌟 Key Features

- **Selective Syncing**: Only notes containing your specified tag (e.g., `#public`) in their body or frontmatter properties will be copied.
- **Wikilink Conversion**: Automatically translates Obsidian `[[Note]]` wikilinks and `![[Image.png]]` embedded assets into standard, relative, URL-friendly Markdown links (`[Note](relative/path/Note.md)`) and image sources, preserving folder structures perfectly.
- **Broken Link notices**: Scans public pages for links pointing to private (untagged) files. It logs them and displays a non-blocking Obsidian `Notice` to prevent dead links on your public site.
- **HTML Property Badges**: Converts Obsidian YAML frontmatter values (such as author, date, status, etc.) into gorgeous GitHub-style HTML badges embedded directly under the title.
- **WSL Git Compatibility**: Runs Git directly on Windows, or wraps and forwards commands to a WSL bash environment with automated Windows-to-WSL path translations (`C:\` to `/mnt/c/`).
- **Granular Git Commit Logs**: Obtains a porcelain diff status of additions, modifications, and deletions to produce a detailed commit message containing lists of affected files.
- **Custom Jekyll Theme**: Initializes a stunning Jekyll template with:
  - **Left Sidebar**: Collapsible file tree with full-text search capabilities.
  - **Right Sidebar**: Fully automatic Table of Contents (TOC) builder with ScrollSpy highlighting as you scroll.
  - **Dark Mode**: High-fidelity dark and light theme switching built-in.
  - **GitHub Issue Reporting**: A dynamic footer button that launches a pre-filled GitHub Issue draft detailing the source file and note name to report typos or give feedback.
- **GitHub Actions Auto-Deployment**: Includes a `.github/workflows/deploy.yml` file to compile and host your Jekyll site directly via GitHub Pages on every single push.

---

## 🛠️ Settings Configuration

1. **Publish Tag**: Tag name to filter for (default: `#public`). Matches inline text and frontmatter YAML properties.
2. **Local Repository Path**: Absolute path where the Git repo clone resides (e.g., `C:\Users\Name\Development\my-digital-garden`).
3. **Remote Git URL**: Your target GitHub SSH or HTTPS repository clone URL.
4. **Target Branch**: Destination Git branch (default: `main`).
5. **GitHub Repo Path**: (Optional) Format: `username/repository`. If left blank, it is automatically parsed from your Remote URL to establish feedback issue links.
6. **Run Git via WSL**: Tick this ON to execute all git actions inside WSL bash rather than Windows cmd/PowerShell.

---

## 🚀 How to Get Started

### Step 1: Initialize Your GitHub Repository
1. Create a **new, blank repository** on GitHub (do not add a README or `.gitignore` yet).
2. Grab the Clone URL (SSH recommended).

### Step 2: Configure the Plugin in Obsidian
1. Open Obsidian ➔ Settings ➔ **Publish on GitHub**.
2. Input your **Local Repository Path** (where the local clone will reside).
3. Input your **Remote Git URL**.
4. If you are on Windows but want to use your Linux Git inside WSL, toggle **Run Git via WSL** on.

### Step 3: Initialize Layouts & Theme
1. In the plugin settings, click **Initialize Theme**. This creates the custom layouts, styles, configuration files, and GitHub Action workflows in your local folder.
2. Mark a test file in your vault with `#public`.
3. Click the **Ribbon Icon (Share)** or open the Command Palette (`Ctrl+P`) and select `Publish on GitHub: Publish Public Notes`.
4. This will run the pipeline: gather the files, translate assets, compile the commit body, and push them to your repository on GitHub.

### Step 4: Enable GitHub Pages
1. Go to your repository on GitHub ➔ **Settings** ➔ **Pages**.
2. Under **Build and deployment** ➔ **Source**, select **GitHub Actions**.
3. Since the plugin automatically pushed the `.github/workflows/deploy.yml` configuration, GitHub Actions will automatically start building and hosting your pages.
4. Your site is live!

---

## 🧹 Maintenance and Actions

- **Initialize Jekyll Theme**: Run this at any time to update your Jekyll templates, styles, and configurations to the newest versions without losing your synced markdown notes.
- **Reset Local Repository**: If Git is out of sync or encounters a state conflict, click **Reset Repo**. This deletes your local repository folder and performs a fresh clone and configuration from your remote repository safely.
- **Commit Body Structure**: The plugin writes the commit messages directly to `.git/commit-msg.txt` and uses `git commit -F` to completely eliminate terminal newline/escaping failures. The generated commits have the following clean format:
  ```
  Publish updates: +3 ~1 -2

  Detailed Site Changes:

  Added:
    - folder/Note1.md
    - folder/Note2.md
    - assets/images/cool-diagram.png

  Modified:
    - index.md

  Removed:
    - folder/OldNote.md
  ```
