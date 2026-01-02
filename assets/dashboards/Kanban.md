

```dataviewjs
const plugin = app.plugins.plugins["creation-ledger"];

if (!plugin || !plugin.constants) {
  dv.paragraph("Creation Ledger plugin is not available.");
  return;
}

const {
  ROOT_FOLDER,
  ARCHIVE_FOLDER,
  FRONTMATTER_TYPE,
  REGISTRIES,
  DEFAULT_STATUSES,
  TAG_PREFIX,
  CSS,
  UI
} = plugin.constants;

// Helper function to read registry list (similar to plugin's readRegistryList)
function readRegistryList(content) {
  if (!content) return [];
  
  const lines = content.split("\n");
  let i = 0;
  
  // Skip frontmatter if present
  if (lines[i]?.trim() === "---") {
    i++;
    while (i < lines.length && lines[i].trim() !== "---") i++;
    if (lines[i]?.trim() === "---") i++;
  }
  
  const items = [];
  for (; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("- ")) {
      const item = line.substring(2).trim();
      if (item && !item.startsWith("#")) items.push(item);
    }
  }
  
  // Deduplicate, preserve order
  const seen = new Set();
  return items.filter((x) => {
    const key = x.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Get all activity notes (excluding archived files)
function getAllPages() {
  return dv.pages(`"${ROOT_FOLDER}"`).where(p => 
    p.type === FRONTMATTER_TYPE && 
    !p.file.path.startsWith(`${ROOT_FOLDER}/${ARCHIVE_FOLDER}/`)
  );
}

let allPages = getAllPages();

// Load statuses from registry file (async)
let registryStatuses = [];
(async () => {
  if (!plugin) {
    console.warn("Creation Ledger plugin not found. Make sure it's enabled.");
  }
  try {
    const statusRegistryFile = app.vault.getAbstractFileByPath(`${ROOT_FOLDER}/${REGISTRIES.STATUSES}`);
    if (statusRegistryFile) {
      const content = await app.vault.read(statusRegistryFile);
      registryStatuses = readRegistryList(content);
    } else {
      // Fallback to default statuses if file doesn't exist
      registryStatuses = DEFAULT_STATUSES;
    }
  } catch (error) {
    console.warn("Could not read statuses registry:", error);
    // Fallback to default statuses
    registryStatuses = DEFAULT_STATUSES;
  }
  
  // Get statuses from notes (for any statuses used but not in registry)
  const statusesFromNotes = [...new Set(allPages.map(p => p.status).filter(Boolean))].sort();
  
  // Combine registry statuses with any additional statuses found in notes
  const allStatuses = [...new Set([...registryStatuses, ...statusesFromNotes])].sort();

  // Initialize visible statuses - all visible by default
  const visibleStatuses = new Set(allStatuses);

  // Get projects for filter
  const projects = [...new Set(allPages.map(p => p.project).filter(Boolean))].sort();
  
  // Create filter container
  const filterContainer = dv.container.createDiv({ cls: CSS.KANBAN_FILTERS });
  filterContainer.style.marginBottom = "1em";
  
  // Project filter
  const projectLabel = filterContainer.createEl("label", { text: UI.PROJECT_LABEL });
  const projectSelect = filterContainer.createEl("select");
  projectSelect.createEl("option", { text: UI.ALL, value: "" });
  projects.forEach(p => projectSelect.createEl("option", { text: p, value: p }));
  
  // Status visibility toggle container
  const statusToggleContainer = dv.container.createDiv();
  statusToggleContainer.style.marginBottom = "1em";
  statusToggleContainer.style.padding = "0.75em";
  statusToggleContainer.style.backgroundColor = "var(--background-secondary)";
  statusToggleContainer.style.borderRadius = "4px";
  statusToggleContainer.style.border = "1px solid var(--background-modifier-border)";
  
  const statusToggleHeader = statusToggleContainer.createDiv();
  statusToggleHeader.style.display = "flex";
  statusToggleHeader.style.justifyContent = "space-between";
  statusToggleHeader.style.alignItems = "center";
  statusToggleHeader.style.marginBottom = "0.5em";
  
  const statusToggleLabel = statusToggleHeader.createEl("div", { text: "Show/Hide Status Columns:" });
  statusToggleLabel.style.fontWeight = "bold";
  
  // Archive Done button
  const archiveButton = statusToggleHeader.createEl("button", { text: "Archive Done" });
  archiveButton.style.padding = "0.4em 0.8em";
  archiveButton.style.border = "1px solid var(--background-modifier-border)";
  archiveButton.style.borderRadius = "4px";
  archiveButton.style.backgroundColor = "var(--background-primary)";
  archiveButton.style.color = "var(--text-normal)";
  archiveButton.style.cursor = "pointer";
  archiveButton.style.fontSize = "0.9em";
  
  const statusCheckboxesContainer = statusToggleContainer.createDiv();
  statusCheckboxesContainer.style.display = "flex";
  statusCheckboxesContainer.style.flexWrap = "wrap";
  statusCheckboxesContainer.style.gap = "0.75em";
  
  // Create checkbox for each status
  const statusCheckboxes = new Map();
  allStatuses.forEach(status => {
    const checkboxWrapper = statusCheckboxesContainer.createDiv();
    checkboxWrapper.style.display = "flex";
    checkboxWrapper.style.alignItems = "center";
    checkboxWrapper.style.gap = "0.25em";
    
    const checkbox = checkboxWrapper.createEl("input", { type: "checkbox" });
    checkbox.checked = true; // All visible by default
    checkbox.id = `status-toggle-${status}`;
    
    const label = checkboxWrapper.createEl("label", { text: status });
    label.setAttribute("for", checkbox.id);
    label.style.cursor = "pointer";
    label.style.userSelect = "none";
    
    statusCheckboxes.set(status, checkbox);
    
    // Add change listener
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        visibleStatuses.add(status);
      } else {
        visibleStatuses.delete(status);
      }
      renderKanban();
    });
  });
  
  // Archive Done button click handler
  archiveButton.addEventListener("click", async () => {
    const confirmed = window.confirm("Move all tasks marked 'done' to the archive directory?");
    if (!confirmed) {
      return;
    }
    
    const archivePath = `${ROOT_FOLDER}/${ARCHIVE_FOLDER}`;
    
    // Ensure archive folder exists
    const archiveFolder = app.vault.getAbstractFileByPath(archivePath);
    if (!archiveFolder) {
      try {
        await app.vault.createFolder(archivePath);
      } catch (error) {
        console.error("Failed to create archive folder:", error);
        return;
      }
    }
    
    // Identify "done" tasks (case-insensitive)
    const doneStatus = allStatuses.find(s => s.toLowerCase() === "done");
    if (!doneStatus) {
      return; // No "done" status found
    }
    
    // Get all pages with "done" status that aren't already archived
    const donePages = allPages.where(p => 
      p.status && 
      p.status.toLowerCase() === "done" &&
      !p.file.path.startsWith(`${ROOT_FOLDER}/${ARCHIVE_FOLDER}/`)
    );
    
    // Move each file to archive
    for (const page of donePages) {
      const file = app.vault.getAbstractFileByPath(page.file.path);
      if (!file) continue;
      
      const newPath = `${archivePath}/${file.name}`;
      
      // Check if file already exists at destination
      const existingFile = app.vault.getAbstractFileByPath(newPath);
      if (existingFile) {
        console.warn(`File already exists at ${newPath}, skipping`);
        continue;
      }
      
      try {
        await app.vault.rename(file, newPath);
      } catch (error) {
        console.error(`Failed to move ${file.path}:`, error);
      }
    }
    
    // Refresh pages list and re-render
    allPages = getAllPages();
    await renderKanban();
  });
  
  // Kanban board container
  const boardContainer = dv.container.createDiv({ cls: CSS.KANBAN_BOARD });
  boardContainer.style.display = "grid";
  boardContainer.style.gridTemplateColumns = `repeat(${visibleStatuses.size}, 1fr)`;
  boardContainer.style.gap = "1em";
  boardContainer.style.marginTop = "1em";

  function getFilteredPages() {
    const selectedProject = projectSelect.value;
    let filtered = allPages;
    
    if (selectedProject) {
      filtered = filtered.where(p => p.project && p.project.toLowerCase() === selectedProject.toLowerCase());
    }
    
    return filtered;
  }
  
  async function createCard(note, container) {
    const card = container.createDiv({ cls: CSS.KANBAN_CARD });
    card.style.border = "1px solid var(--background-modifier-border)";
    card.style.borderRadius = "4px";
    card.style.padding = "0.75em";
    card.style.marginBottom = "0.5em";
    card.style.backgroundColor = "var(--background-secondary)";
    card.style.cursor = "pointer";
    
    // Title (clickable link)
    const title = card.createEl("div");
    title.style.fontWeight = "bold";
    title.style.marginBottom = "0.5em";
    const link = title.createEl("a", { 
      text: note.file.name.replace(/\.md$/, ""),
      href: note.file.path
    });
    link.addEventListener("click", (e) => {
      e.stopPropagation();
      app.workspace.openLinkText(note.file.path, "", true);
    });
    
    // Project
    if (note.project) {
      const projectDiv = card.createEl("div", { text: `Project: ${note.project}` });
      projectDiv.style.fontSize = "0.85em";
      projectDiv.style.color = "var(--text-muted)";
      projectDiv.style.marginBottom = "0.25em";
    }
    
    // Category
    if (note.category) {
      const categoryDiv = card.createEl("div", { text: `Category: ${note.category}` });
      categoryDiv.style.fontSize = "0.85em";
      categoryDiv.style.color = "var(--text-muted)";
      categoryDiv.style.marginBottom = "0.25em";
    }
    
    // Tags
    const tags = (note.file.tags || []).filter(t => t.startsWith(TAG_PREFIX));
    if (tags.length > 0) {
      const tagsDiv = card.createEl("div");
      tagsDiv.style.fontSize = "0.75em";
      tagsDiv.style.marginTop = "0.5em";
      tags.forEach(tag => {
        const tagSpan = tagsDiv.createEl("span", { 
          text: tag.replace(new RegExp(`^${TAG_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), ""),
          cls: CSS.TAG
        });
        tagSpan.style.display = "inline-block";
        tagSpan.style.marginRight = "0.25em";
        tagSpan.style.padding = "0.1em 0.4em";
        tagSpan.style.backgroundColor = "var(--background-modifier-border)";
        tagSpan.style.borderRadius = "3px";
      });
    }
    
    // Status change dropdown - use plugin's renderStatusDropdown
    const statusDiv = card.createEl("div");
    statusDiv.style.marginTop = "0.5em";
    statusDiv.style.paddingTop = "0.5em";
    statusDiv.style.borderTop = "1px solid var(--background-modifier-border)";
    
    // Resolve file for this note
    const file = app.vault.getAbstractFileByPath(note.file.path);
    if (!file) {
      statusDiv.createEl("em", { text: UI.FILE_NOT_FOUND });
      return;
    }
    
    if (!plugin) {
      statusDiv.createEl("em", { text: UI.PLUGIN_NOT_FOUND });
      return;
    }
    
    if (typeof plugin.renderStatusDropdown !== "function") {
      statusDiv.createEl("em", { text: UI.RENDER_STATUS_DROPDOWN_NOT_AVAILABLE });
      return;
    }
    
    try {
      // Await the async renderStatusDropdown to ensure it completes
      await plugin.renderStatusDropdown({ container: statusDiv, file: file });
    } catch (err) {
      console.error("Error rendering status dropdown:", err);
      statusDiv.createEl("em", { text: `Error: ${err.message || "Unknown error"}` });
    }
  }

  async function renderKanban() {
    const filtered = getFilteredPages();
    
    boardContainer.empty();
    
    // Update grid columns based on visible statuses
    boardContainer.style.gridTemplateColumns = `repeat(${visibleStatuses.size}, 1fr)`;
    
    // Create columns for each status (only if visible)
    for (const status of allStatuses) {
      if (!visibleStatuses.has(status)) continue;
      
      const column = boardContainer.createDiv({ cls: CSS.KANBAN_COLUMN });
      column.style.display = "flex";
      column.style.flexDirection = "column";
      
      // Column header
      const header = column.createEl("h3", { text: status });
      header.style.marginTop = "0";
      header.style.marginBottom = "0.5em";
      header.style.padding = "0.5em";
      header.style.backgroundColor = "var(--background-modifier-border)";
      header.style.borderRadius = "4px";
      header.style.textAlign = "center";
      
      // Cards for this status
      const statusNotes = filtered.where(p => 
        p.status && p.status.toLowerCase() === status.toLowerCase()
      );
      
      const count = statusNotes.length;
      const countBadge = header.createEl("span", { text: ` (${count})` });
      countBadge.style.fontSize = "0.85em";
      countBadge.style.color = "var(--text-muted)";
      
      // Cards container
      const cardsContainer = column.createDiv({ cls: CSS.KANBAN_CARDS });
      
      if (statusNotes.length === 0) {
        const emptyMsg = cardsContainer.createEl("div", { text: UI.NO_ITEMS });
        emptyMsg.style.textAlign = "center";
        emptyMsg.style.color = "var(--text-muted)";
        emptyMsg.style.fontSize = "0.9em";
        emptyMsg.style.padding = "1em";
      } else {
        // Use Promise.all to handle async createCard calls
        const cardPromises = statusNotes
          .sort(p => p.datetime, "desc")
          .map(note => createCard(note, cardsContainer));
          await Promise.all(cardPromises);
      }
    }
  }
  
  // Initial render
  await renderKanban();
  
  // Add change listener for project filter
  projectSelect.addEventListener("change", renderKanban);
})();
```
