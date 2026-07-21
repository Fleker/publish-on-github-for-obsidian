document.addEventListener('DOMContentLoaded', () => {
  // --- 1. Dynamic File Tree Explorer ---
  const treeContainer = document.getElementById('file-tree');
  const searchInput = document.getElementById('tree-search');

  if (treeContainer && typeof sitePages !== 'undefined') {
    const currentUrl = window.location.pathname;

    function buildTree(pages) {
      const root = { folders: {}, files: [] };
      pages.forEach(page => {
        if (!page.path || page.path === 'index.md') return;
        const parts = page.path.split('/');
        let current = root;
        for (let i = 0; i < parts.length - 1; i++) {
          const folderName = parts[i];
          if (!current.folders[folderName]) {
            current.folders[folderName] = { folders: {}, files: [] };
          }
          current = current.folders[folderName];
        }
        current.files.push(page);
      });
      return root;
    }

    function renderTree(node, container, pathPrefix = '') {
      const ul = document.createElement('ul');
      ul.className = 'tree-list';

      // Render Folders
      Object.keys(node.folders).sort().forEach(folderName => {
        const li = document.createElement('li');
        li.className = 'tree-item';

        const folderDiv = document.createElement('div');
        folderDiv.className = 'tree-folder';
        folderDiv.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="folder-icon"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg> ${folderName}`;

        const subContainer = document.createElement('ul');
        subContainer.className = 'tree-folder-contents';
        subContainer.style.display = 'none'; // Collapsed by default

        folderDiv.addEventListener('click', () => {
          const isCollapsed = subContainer.style.display === 'none';
          subContainer.style.display = isCollapsed ? 'block' : 'none';
        });

        li.appendChild(folderDiv);
        renderTree(node.folders[folderName], subContainer, pathPrefix + folderName + '/');
        li.appendChild(subContainer);
        ul.appendChild(li);

        // Auto-expand folder if it contains the current page
        if (currentUrl.includes(pathPrefix + folderName + '/')) {
          subContainer.style.display = 'block';
        }
      });

      // Render Files
      node.files.sort((a,b) => a.title.localeCompare(b.title)).forEach(page => {
        const li = document.createElement('li');
        li.className = 'tree-item';

        const a = document.createElement('a');
        a.className = 'tree-file-link';
        a.href = page.url;
        a.textContent = page.title;

        // Active link highlight
        const normalizedCurrent = currentUrl.replace(/\\/g, '/').replace(/index\.html$/, '').replace(/\/$/, '');
        const normalizedPage = page.url.replace(/\\/g, '/').replace(/index\.html$/, '').replace(/\/$/, '');
        if (normalizedCurrent === normalizedPage) {
          a.className += ' active';
          // Bubble expand parents
          let parent = li.parentElement;
          while (parent && parent.className === 'tree-folder-contents') {
            parent.style.display = 'block';
            parent = parent.parentElement?.parentElement;
          }
        }

        li.appendChild(a);
        ul.appendChild(li);
      });

      container.appendChild(ul);
    }

    const treeData = buildTree(sitePages);
    renderTree(treeData, treeContainer);

    // Search Filtering
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        const items = treeContainer.querySelectorAll('.tree-item');

        items.forEach(item => {
          const fileLink = item.querySelector('.tree-file-link');
          const folderDiv = item.querySelector('.tree-folder');

          if (fileLink) {
            const text = fileLink.textContent.toLowerCase();
            if (text.includes(query)) {
              item.style.display = 'block';
              // Expand all parent folders
              let parent = item.parentElement;
              while (parent && parent.className === 'tree-folder-contents') {
                parent.style.display = 'block';
                parent = parent.parentElement?.parentElement;
              }
            } else {
              item.style.display = 'none';
            }
          }

          if (folderDiv && query === '') {
            // Restore collapsed folders if search cleared
            const contents = item.querySelector('.tree-folder-contents');
            if (contents && !currentUrl.includes(folderDiv.textContent.trim())) {
              contents.style.display = 'none';
            }
          }
        });
      });
    }
  }

  // --- 2. Dynamic Table of Contents (Right Sidebar) ---
  const mainContent = document.querySelector('main');
  const tocContainer = document.getElementById('toc-content');

  if (mainContent && tocContainer) {
    const headers = mainContent.querySelectorAll('h1, h2, h3');
    if (headers.length > 0) {
      const tocUl = document.createElement('div');

      headers.forEach((header, index) => {
        if (!header.id) {
          header.id = 'header-' + index;
        }

        const a = document.createElement('a');
        a.className = 'toc-link';
        a.href = '#' + header.id;
        a.textContent = header.textContent;
        const level = parseInt(header.tagName.substring(1));
        a.style.paddingLeft = `${(level - 1) * 12}px`;

        tocUl.appendChild(a);
      });
      tocContainer.appendChild(tocUl);

      // --- 3. ScrollSpy Functionality ---
      const tocLinks = tocContainer.querySelectorAll('.toc-link');
      const observerOptions = {
        root: null,
        rootMargin: '0px 0px -60% 0px',
        threshold: 0
      };

      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const activeId = entry.target.id;
            tocLinks.forEach(link => {
              if (link.getAttribute('href') === '#' + activeId) {
                link.classList.add('active');
              } else {
                link.classList.remove('active');
              }
            });
          }
        });
      }, observerOptions);

      headers.forEach(header => observer.observe(header));
    } else {
      const rightSidebar = document.querySelector('.sidebar-right');
      if (rightSidebar) rightSidebar.style.display = 'none';
    }
  }
});
