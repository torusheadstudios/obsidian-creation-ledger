const { Plugin, Modal, Notice, Setting, TFile, SettingTab } = require("obsidian");

// =====================
// Constants
// =====================
const PLUGIN_ID = "creation-ledger";

// Default settings
const DEFAULT_SETTINGS = {
  rootFolder: "CreationLedger",
  archiveFolderName: "archive",
  frontmatterType: "creation-ledger"
};

// Plugin path constants
const PATH_PLUGINS = "/plugins";
const PATH_ASSETS_DASHBOARDS = "/assets/dashboards";
const PATH_ASSETS_DATA_REGISTRIES = "/assets/data-registries";

// Folder name constants
const FOLDER_DASHBOARDS = "_dashboards";
const FOLDER_ARCHIVE = "archive";

// Registry filename constants
const FILENAME_PROJECTS_REGISTRY = "_projects.md";
const FILENAME_STATUSES_REGISTRY = "_statuses.md";
const FILENAME_TAGS_REGISTRY = "_tags.md";
const FILENAME_ACTIONS_REGISTRY = "_actions.md";
const FILENAME_DELIVERABLES_REGISTRY = "_deliverables.md";

// Dashboard filename constants
const FILENAME_DASHBOARD_KANBAN = "Kanban.md";
const FILENAME_DASHBOARD_TODAY = "Today.md";
const FILENAME_DASHBOARD_ACTIVITY = "Activity Dashboard.md";
const FILENAME_DASHBOARD_TAGS = "Tags.md";
const FILENAME_DASHBOARD_TAGS_VAULT = "Tags Dashboard.md";

// Registry path constants are now dynamic via plugin methods

// =====================
// Helpers
// =====================
function slugify(value) {
  if (!value) return "";
  return value
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\w\-]+/g, "")
    .replace(/\-\-+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}

function sanitizeFilename(title) {
  if (!title) return "";
  return title.replace(/[<>:"/\\|?*]/g, "").trim().replace(/\s+/g, " ");
}

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

function writeRegistryList(content, newItems) {
  if (!content) content = "---\ntype: creationledger-registry\nregistry: tags\n---\n";

  const lines = content.split("\n");
  let i = 0;
  let frontmatterEnd = 0;

  // Find frontmatter end
  if (lines[i]?.trim() === "---") {
    i++;
    while (i < lines.length && lines[i].trim() !== "---") i++;
    if (lines[i]?.trim() === "---") {
      frontmatterEnd = i + 1;
      i++;
    }
  }

  // Extract existing items
  const existingItems = [];
  const seen = new Set();
  for (; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("- ")) {
      const item = line.substring(2).trim();
      if (item && !item.startsWith("#")) {
        const key = item.toLowerCase();
        if (!seen.has(key)) {
          existingItems.push(item);
          seen.add(key);
        }
      }
    }
  }

  // Add new items (case-insensitive check)
  newItems.forEach((item) => {
    const key = item.toLowerCase();
    if (!seen.has(key)) {
      existingItems.push(item);
      seen.add(key);
    }
  });

  // Reconstruct file
  const frontmatterLines = lines.slice(0, frontmatterEnd);
  const newLines = existingItems.map((item) => `- ${item}`);
  return [...frontmatterLines, ...newLines].join("\n") + "\n";
}

async function openFile(app, path) {
  const f = app.vault.getAbstractFileByPath(path);
  if (f && f instanceof TFile) {
    await app.workspace.openLinkText(path, "", true);
  } else {
    new Notice(`File not found: ${path}`);
  }
}

/**
 * Get the plugin's base path
 * @param {App} app - Obsidian app instance
 * @returns {string} - Plugin base path
 */
function getPluginBasePath(app) {
  return `${app.vault.configDir}${PATH_PLUGINS}/${PLUGIN_ID}`;
}

/**
 * Get path to bundled dashboards
 * @param {App} app - Obsidian app instance
 * @returns {string} - Bundled dashboards path
 */
function getBundledDashboardsPath(app) {
  return `${getPluginBasePath(app)}${PATH_ASSETS_DASHBOARDS}`;
}

/**
 * Get path to bundled registries
 * @param {App} app - Obsidian app instance
 * @returns {string} - Bundled registries path
 */
function getBundledRegistriesPath(app) {
  return `${getPluginBasePath(app)}${PATH_ASSETS_DATA_REGISTRIES}`;
}

/**
 * Ensure parent folder exists for a given file path (creates all necessary parent folders)
 * @param {App} app - Obsidian app instance
 * @param {string} filePath - File path
 */
async function ensureParentFolder(app, filePath) {
  const adapter = app.vault.adapter;
  const pathParts = filePath.split("/");
  
  // Remove filename, keep only folder parts
  if (pathParts.length > 1) {
    // Build up parent path incrementally to ensure all levels exist
    let currentPath = "";
    for (let i = 0; i < pathParts.length - 1; i++) {
      if (i === 0) {
        currentPath = pathParts[i];
      } else {
        currentPath = `${currentPath}/${pathParts[i]}`;
      }
      
      // Check actual filesystem
      if (!(await adapter.exists(currentPath))) {
        try {
          await app.vault.createFolder(currentPath);
        } catch (e) {
          // Safely ignore "already exists" errors
          if (!e.message?.includes("already exists")) {
            console.warn(`Could not create parent folder ${currentPath}:`, e);
          }
        }
      }
    }
  }
}

/**
 * Copy a bundled file to target path if target doesn't exist
 * @param {App} app - Obsidian app instance
 * @param {string} targetPath - Target path in vault
 * @param {string} bundledSourcePath - Source path in plugin assets
 */
async function copyBundledFileIfMissing(app, targetPath, bundledSourcePath) {
  const adapter = app.vault.adapter;
  
  // Check actual filesystem, not cache
  if (await adapter.exists(targetPath)) {
    return;
  }

  try {
    // Ensure parent folder exists before creating file
    await ensureParentFolder(app, targetPath);
    
    // Read from bundled file
    const bundledContent = await adapter.read(bundledSourcePath);
    
    // Create target file with identical contents
    await app.vault.create(targetPath, bundledContent);
  } catch (err) {
    console.warn(`Could not copy bundled file ${bundledSourcePath} to ${targetPath}:`, err);
  }
}

async function appendToRegistry(app, registryPath, bundledRegistryPath, newItems) {
  if (newItems.length === 0) return;

  const adapter = app.vault.adapter;
  let file = null;
  let content = "";

  // Check actual filesystem, not cache
  if (await adapter.exists(registryPath)) {
    file = app.vault.getAbstractFileByPath(registryPath);
    if (file instanceof TFile) {
      content = await app.vault.read(file);
    }
  } else {
    // Read from bundled file if target doesn't exist
    try {
      content = await adapter.read(bundledRegistryPath);
    } catch (err) {
      console.warn(`Could not read bundled registry ${bundledRegistryPath}:`, err);
      // Fallback to minimal frontmatter
      content = "---\ntype: creationledger-registry\nregistry: tags\n---\n";
    }
    
    // Ensure parent folder exists before creating file
    await ensureParentFolder(app, registryPath);
    
    // Create file with bundled content
    await app.vault.create(registryPath, content);
    file = app.vault.getAbstractFileByPath(registryPath);
  }

  const updated = writeRegistryList(content, newItems);
  if (file instanceof TFile) {
    await app.vault.modify(file, updated);
  }
}

async function appendToProjectsRegistry(app, plugin, newProject) {
  if (!newProject) return;
  const bundledPath = `${getBundledRegistriesPath(app)}/${FILENAME_PROJECTS_REGISTRY}`;
  await appendToRegistry(app, plugin.getProjectsRegistry(), bundledPath, [newProject]);
}

// =====================
// Modals
// =====================
class StatusChangeModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Change Status" });
    await this.plugin.renderStatusDropdown({ container: contentEl });
  }

  onClose() {
    this.contentEl.empty();
  }
}

class CreationLedgerModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;

    this.data = {
      title: "",
      project: "",
      status: "in-progress",
      category: "",
      action: "",
      deliverable: "",
      tags: "", // comma-separated input
      notes: "",
    };
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("creationledger-modal");

    // Ensure registries are loaded
    await this.plugin.loadProjects();
    await this.plugin.loadStatuses();
    await this.plugin.loadActions();
    await this.plugin.loadDeliverables();
    await this.plugin.loadTagSuggestions();

    contentEl.createEl("h2", { text: "Capture Activity" });

    // Title
    new Setting(contentEl)
      .setName("Note Title *")
      .addText((t) => {
        t.setPlaceholder("Enter activity title");
        t.onChange((v) => (this.data.title = v));
        t.inputEl.style.width = "100%";
      });

    // Project (dropdown with editable support)
    let projects = this.plugin.projects;
    if (!projects || projects.length === 0) {
      // Fallback: try to read from bundled file
      try {
        const bundledPath = `${getBundledRegistriesPath(this.app)}/${FILENAME_PROJECTS_REGISTRY}`;
        const adapter = this.app.vault.adapter;
        const content = await adapter.read(bundledPath);
        projects = readRegistryList(content);
      } catch (err) {
        projects = [];
      }
    }

    const projectSetting = new Setting(contentEl).setName("Project");
    projectSetting.addDropdown((dd) => {
      dd.addOption("", "— Select project —");
      projects.forEach((p) => dd.addOption(p, p));
      dd.setValue(this.data.project || "");
      dd.onChange((v) => (this.data.project = v));
      dd.selectEl.style.width = "100%";
    });

    projectSetting.addExtraButton((btn) => {
      btn.setIcon("file-edit");
      btn.setTooltip("Edit projects registry");
      btn.onClick(() => openFile(this.app, this.plugin.getProjectsRegistry()));
    });

    // Status (dropdown required)
    let statuses = this.plugin.statuses;
    if (!statuses || statuses.length === 0) {
      // Fallback: try to read from bundled file
      try {
        const bundledPath = `${getBundledRegistriesPath(this.app)}/${FILENAME_STATUSES_REGISTRY}`;
        const adapter = this.app.vault.adapter;
        const content = await adapter.read(bundledPath);
        statuses = readRegistryList(content);
      } catch (err) {
        statuses = [];
      }
    }

    const statusSetting = new Setting(contentEl).setName("Status *");
    statusSetting.addDropdown((dd) => {
      statuses.forEach((s) => dd.addOption(s, s));
      dd.setValue(this.data.status || "in-progress");
      dd.onChange((v) => (this.data.status = v));
      dd.selectEl.style.width = "100%";
    });

    statusSetting.addExtraButton((btn) => {
      btn.setIcon("file-edit");
      btn.setTooltip("Edit statuses registry");
      btn.onClick(() => openFile(this.app, this.plugin.getStatusesRegistry()));
    });

    // Action (dropdown)
    let actions = this.plugin.actions;
    if (!actions || actions.length === 0) {
      // Fallback: try to read from bundled file
      try {
        const bundledPath = `${getBundledRegistriesPath(this.app)}/${FILENAME_ACTIONS_REGISTRY}`;
        const adapter = this.app.vault.adapter;
        const content = await adapter.read(bundledPath);
        actions = readRegistryList(content);
      } catch (err) {
        actions = [];
      }
    }

    const actionSetting = new Setting(contentEl).setName("Action");
    actionSetting.addDropdown((dd) => {
      dd.addOption("", "— Select action —");
      actions.forEach((a) => dd.addOption(a, a));
      dd.setValue(this.data.action || "");
      dd.onChange((v) => (this.data.action = v));
      dd.selectEl.style.width = "100%";
    });

    actionSetting.addExtraButton((btn) => {
      btn.setIcon("file-edit");
      btn.setTooltip("Edit actions registry");
      btn.onClick(() => openFile(this.app, this.plugin.getActionsRegistry()));
    });

    // Deliverable (dropdown)
    let deliverables = this.plugin.deliverables;
    if (!deliverables || deliverables.length === 0) {
      // Fallback: try to read from bundled file
      try {
        const bundledPath = `${getBundledRegistriesPath(this.app)}/${FILENAME_DELIVERABLES_REGISTRY}`;
        const adapter = this.app.vault.adapter;
        const content = await adapter.read(bundledPath);
        deliverables = readRegistryList(content);
      } catch (err) {
        deliverables = [];
      }
    }

    const deliverableSetting = new Setting(contentEl).setName("Deliverable");
    deliverableSetting.addDropdown((dd) => {
      dd.addOption("", "— Select deliverable —");
      deliverables.forEach((d) => dd.addOption(d, d));
      dd.setValue(this.data.deliverable || "");
      dd.onChange((v) => (this.data.deliverable = v));
      dd.selectEl.style.width = "100%";
    });

    deliverableSetting.addExtraButton((btn) => {
      btn.setIcon("file-edit");
      btn.setTooltip("Edit deliverables registry");
      btn.onClick(() => openFile(this.app, this.plugin.getDeliverablesRegistry()));
    });

    // Tags (comma input + chips)
    const tagsSetting = new Setting(contentEl)
      .setName("Tags (comma-separated)")
      .setDesc("Optional. Will become #tag/<slug> tags in the note body.");

    tagsSetting.addText((t) => {
      t.setPlaceholder("writing, research, admin");
      t.onChange((v) => (this.data.tags = v));
      t.inputEl.style.width = "100%";
    });

    if (this.plugin.tagSuggestions.length) {
      const chipsWrap = contentEl.createDiv({ cls: "creationledger-tagchips" });
      this.plugin.tagSuggestions.forEach((tag) => {
        const chip = chipsWrap.createEl("button", {
          cls: "creationledger-chip",
          text: tag,
        });
        chip.type = "button";
        chip.addEventListener("click", () => {
          const current = (this.data.tags || "")
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean);

          if (!current.some((x) => x.toLowerCase() === tag.toLowerCase())) {
            current.push(tag);
            this.data.tags = current.join(", ");
            // update the last text input in the Setting (safe enough here)
            const inputs = contentEl.querySelectorAll("input[type='text']");
            const tagInput = inputs[inputs.length - 1];
            if (tagInput) tagInput.value = this.data.tags;
          }
        });
      });

      const editTags = chipsWrap.createEl("button", {
        cls: "creationledger-chip creationledger-chip-muted",
        text: "Edit tag presets…",
      });
      editTags.type = "button";
      editTags.addEventListener("click", () => openFile(this.app, this.plugin.getTagsRegistry()));
    }

    // Notes
    new Setting(contentEl).setName("Notes (optional)").addTextArea((ta) => {
      ta.setPlaceholder("Additional notes…");
      ta.onChange((v) => (this.data.notes = v));
      ta.inputEl.style.width = "100%";
      ta.inputEl.style.minHeight = "90px";
    });

    // Buttons
    const buttons = contentEl.createDiv({ cls: "creationledger-buttons" });

    const cancel = buttons.createEl("button", { text: "Cancel" });
    cancel.addEventListener("click", () => this.close());

    const submit = buttons.createEl("button", {
      text: "Create Ledger",
      cls: "mod-cta",
    });
    submit.addEventListener("click", () => this.submit());
  }

  async submit() {
    const title = (this.data.title || "").trim();
    if (!title) {
      new Notice("Title is required");
      return;
    }

    const status = (this.data.status || "").trim();
    if (!status) {
      new Notice("Status is required");
      return;
    }

    // Validate status exists in registry
    const statusOk =
      this.plugin.statuses.length === 0 ||
      this.plugin.statuses.some((s) => s.toLowerCase() === status.toLowerCase());
    if (!statusOk) {
      new Notice(`Status not in registry. Edit ${FILENAME_STATUSES_REGISTRY} to add it.`);
      await openFile(this.app, this.plugin.getStatusesRegistry());
      return;
    }

    // Handle project: if new, add to registry
    const project = (this.data.project || "").trim();
    if (project) {
      const projectExists =
        this.plugin.projects.length === 0 ||
        this.plugin.projects.some((p) => p.toLowerCase() === project.toLowerCase());
      
      if (!projectExists) {
        // Add new project to registry
        await appendToProjectsRegistry(this.app, this.plugin, project);
        await this.plugin.loadProjects();
        new Notice(`Added new project "${project}" to registry`);
      }
    }

    // Category (no validation needed - free text)
    const category = (this.data.category || "").trim();

    // Validate action if provided
    const action = (this.data.action || "").trim();
    if (action) {
      const actionOk =
        this.plugin.actions.length === 0 ||
        this.plugin.actions.some((a) => a.toLowerCase() === action.toLowerCase());
      if (!actionOk) {
        new Notice(`Action not in registry. Edit ${FILENAME_ACTIONS_REGISTRY} to add it.`);
        await openFile(this.app, this.plugin.getActionsRegistry());
        return;
      }
    }

    // Validate deliverable if provided
    const deliverable = (this.data.deliverable || "").trim();
    if (deliverable) {
      const deliverableOk =
        this.plugin.deliverables.length === 0 ||
        this.plugin.deliverables.some((d) => d.toLowerCase() === deliverable.toLowerCase());
      if (!deliverableOk) {
        new Notice(`Deliverable not in registry. Edit ${FILENAME_DELIVERABLES_REGISTRY} to add it.`);
        await openFile(this.app, this.plugin.getDeliverablesRegistry());
        return;
      }
    }

    // Process tags and persist new ones
    const userTags = (this.data.tags || "")
      .split(",")
      .map((t) => slugify(t.trim()))
      .filter(Boolean);

    // Persist new tags to tags registry
    if (userTags.length > 0) {
      const bundledTagsPath = `${getBundledRegistriesPath(this.app)}/${FILENAME_TAGS_REGISTRY}`;
      await appendToRegistry(this.app, this.plugin.getTagsRegistry(), bundledTagsPath, userTags);
      await this.plugin.loadTagSuggestions();
    }

    await this.plugin.createCreationLedger({
      title,
      project,
      status,
      category,
      action,
      deliverable,
      tags: userTags,
      notes: this.data.notes || "",
    });

    this.close();
  }

  onClose() {
    this.contentEl.empty();
  }
}

// =====================
// SettingTab
// =====================
class CreationLedgerSettingTab extends SettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Creation Ledger Settings" });

    // Root Folder
    new Setting(containerEl)
      .setName("Creation Ledger Folder")
      .setDesc("The top-level folder where Creation Ledger stores notes, dashboards, and registries.")
      .addText((text) => {
        text.setPlaceholder(DEFAULT_SETTINGS.rootFolder)
          .setValue(this.plugin.settings.rootFolder)
          .onChange(async (value) => {
            const normalized = this.normalizeFolderName(value);
            if (!normalized) {
              new Notice("Root folder cannot be empty. Reverted to default.");
              this.plugin.settings.rootFolder = DEFAULT_SETTINGS.rootFolder;
              await this.plugin.saveSettings();
              this.display(); // Refresh UI
              return;
            }
            this.plugin.settings.rootFolder = normalized;
            await this.plugin.saveSettings();
            this.plugin.updateConstants();
            new Notice("Settings saved");
          });
        text.inputEl.style.width = "100%";
      })
      .addExtraButton((btn) => {
        btn.setIcon("folder-open")
          .setTooltip("Open Root Folder")
          .onClick(() => {
            const rootPath = this.plugin.settings.rootFolder;
            const file = this.app.vault.getAbstractFileByPath(rootPath);
            if (file) {
              this.app.workspace.openLinkText(rootPath, "", false);
            } else {
              new Notice(`Folder not found: ${rootPath}`);
            }
          });
      });

    // Archive Folder Name
    new Setting(containerEl)
      .setName("Archive Folder Name")
      .setDesc("Completed items are moved here when archived.")
      .addText((text) => {
        text.setPlaceholder(DEFAULT_SETTINGS.archiveFolderName)
          .setValue(this.plugin.settings.archiveFolderName)
          .onChange(async (value) => {
            const normalized = this.normalizeFolderName(value);
            if (!normalized) {
              new Notice("Archive folder cannot be empty. Reverted to default.");
              this.plugin.settings.archiveFolderName = DEFAULT_SETTINGS.archiveFolderName;
              await this.plugin.saveSettings();
              this.display(); // Refresh UI
              return;
            }
            this.plugin.settings.archiveFolderName = normalized;
            await this.plugin.saveSettings();
            this.plugin.updateConstants();
            new Notice("Settings saved");
          });
        text.inputEl.style.width = "100%";
      });

    // Frontmatter Type
    new Setting(containerEl)
      .setName("Frontmatter Type")
      .setDesc("Used to identify Creation Ledger notes in Dataview queries.")
      .addText((text) => {
        text.setPlaceholder(DEFAULT_SETTINGS.frontmatterType)
          .setValue(this.plugin.settings.frontmatterType)
          .onChange(async (value) => {
            const normalized = value.trim();
            if (!normalized) {
              new Notice("Frontmatter type cannot be empty. Reverted to default.");
              this.plugin.settings.frontmatterType = DEFAULT_SETTINGS.frontmatterType;
              await this.plugin.saveSettings();
              this.display(); // Refresh UI
              return;
            }
            this.plugin.settings.frontmatterType = normalized;
            await this.plugin.saveSettings();
            this.plugin.updateConstants();
            new Notice("Settings saved");
          });
        text.inputEl.style.width = "100%";
      });
  }

  normalizeFolderName(value) {
    if (!value) return "";
    // Remove leading/trailing slashes and whitespace
    const normalized = value.trim().replace(/^\/+|\/+$/g, "");
    return normalized || "";
  }
}

// =====================
// Plugin
// =====================
module.exports = class CreationLedgerPlugin extends Plugin {
  settings = DEFAULT_SETTINGS;
  projects = [];
  statuses = [];
  tagSuggestions = [];
  actions = [];
  deliverables = [];

  // Expose constants for use in dashboards (updated dynamically)
  constants = {
    PLUGIN_ID: "creation-ledger",
    ROOT_FOLDER: DEFAULT_SETTINGS.rootFolder,
    ARCHIVE_FOLDER: DEFAULT_SETTINGS.archiveFolderName,
    ARCHIVE_PATH: `${DEFAULT_SETTINGS.rootFolder}/${DEFAULT_SETTINGS.archiveFolderName}`,
    FRONTMATTER_TYPE: DEFAULT_SETTINGS.frontmatterType,
    REGISTRIES: {
      STATUSES: FILENAME_STATUSES_REGISTRY,
      PROJECTS: FILENAME_PROJECTS_REGISTRY,
      TAGS: FILENAME_TAGS_REGISTRY,
      ACTIONS: FILENAME_ACTIONS_REGISTRY,
      DELIVERABLES: FILENAME_DELIVERABLES_REGISTRY
    },
    DEFAULT_STATUSES: ["todo", "in-progress", "blocked", "done", "paused"],
    TAG_PREFIX: "#tag/",
    CSS: {
      KANBAN_FILTERS: "activitylog-kanban-filters",
      KANBAN_BOARD: "activitylog-kanban-board",
      KANBAN_CARD: "activitylog-kanban-card",
      KANBAN_COLUMN: "activitylog-kanban-column",
      KANBAN_CARDS: "activitylog-kanban-cards",
      TAG: "activitylog-tag",
      FILTERS: "activitylog-filters",
      RESULTS: "activitylog-results"
    },
    UI: {
      PROJECT_LABEL: "Project: ",
      STATUS_LABEL: " Status: ",
      CATEGORY_LABEL: " Category: ",
      ALL: "All",
      NO_ITEMS: "No items",
      FILE_NOT_FOUND: "File not found",
      PLUGIN_NOT_FOUND: "plugin not found",
      RENDER_STATUS_DROPDOWN_NOT_AVAILABLE: "renderStatusDropdown method not available",
      NO_IN_PROGRESS: "No in-progress activities.",
      NO_BLOCKED: "No blocked activities.",
      NO_ACTIVITIES: "No activities found.",
      CREATION_LEDGER_PLUGIN_NOT_AVAILABLE: "Creation Ledger plugin is not available."
    }
  };

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.updateConstants();
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.updateConstants();
  }

  updateConstants() {
    this.constants.ROOT_FOLDER = this.settings.rootFolder;
    this.constants.ARCHIVE_FOLDER = this.settings.archiveFolderName;
    this.constants.ARCHIVE_PATH = `${this.settings.rootFolder}/${this.settings.archiveFolderName}`;
    this.constants.FRONTMATTER_TYPE = this.settings.frontmatterType;
  }

  // Helper methods to get paths dynamically from settings
  getRootFolder() {
    return this.settings.rootFolder;
  }

  getDashboardsFolder() {
    return `${this.settings.rootFolder}/${FOLDER_DASHBOARDS}`;
  }

  getArchiveFolder() {
    return `${this.settings.rootFolder}/${this.settings.archiveFolderName}`;
  }

  getProjectsRegistry() {
    return `${this.settings.rootFolder}/${FILENAME_PROJECTS_REGISTRY}`;
  }

  getStatusesRegistry() {
    return `${this.settings.rootFolder}/${FILENAME_STATUSES_REGISTRY}`;
  }

  getTagsRegistry() {
    return `${this.settings.rootFolder}/${FILENAME_TAGS_REGISTRY}`;
  }

  getActionsRegistry() {
    return `${this.settings.rootFolder}/${FILENAME_ACTIONS_REGISTRY}`;
  }

  getDeliverablesRegistry() {
    return `${this.settings.rootFolder}/${FILENAME_DELIVERABLES_REGISTRY}`;
  }

  getFrontmatterType() {
    return this.settings.frontmatterType;
  }

  async onload() {
    await this.loadSettings();
    await this.ensureFolders();
    await this.ensureRegistries();
    await this.ensureDashboards();
    await this.loadRegistries();

    // Watch registries for changes
    this.registerEvent(
      this.app.vault.on("modify", async (file) => {
        if (!file?.path) return;
        if (file.path === this.getProjectsRegistry()) await this.loadProjects();
        if (file.path === this.getStatusesRegistry()) await this.loadStatuses();
        if (file.path === this.getTagsRegistry()) await this.loadTagSuggestions();
        if (file.path === this.getActionsRegistry()) await this.loadActions();
        if (file.path === this.getDeliverablesRegistry()) await this.loadDeliverables();
      })
    );

    // Register workspace event for status UI
    // Note: Obsidian doesn't have native workspace.trigger(), so we'll add a custom trigger method
    // The plugin instance can also be accessed directly from DataviewJS: app.plugins.plugins["creation-ledger"]
    const pluginInstance = this;
    if (!this.app.workspace.creationLedgerPlugin) {
      this.app.workspace.creationLedgerPlugin = pluginInstance;
      // Add a trigger method for compatibility with instructions
      if (!this.app.workspace.trigger) {
        this.app.workspace.trigger = function(eventName, payload) {
          if (eventName === "creation-ledger:status-ui" && this.creationLedgerPlugin) {
            this.creationLedgerPlugin.renderStatusDropdown(payload);
          }
        }.bind(this.app.workspace);
      }
    }

    this.addCommand({
      id: "capture",
      name: "Capture Activity",
      callback: () => new CreationLedgerModal(this.app, this).open(),
    });

    this.addCommand({
      id: "open-today",
      name: "Open Today Dashboard",
      callback: () => this.openDashboard(`${this.getDashboardsFolder()}/${FILENAME_DASHBOARD_TODAY}`),
    });

    this.addCommand({
      id: "open-activity",
      name: "Open Activity Dashboard",
      callback: () => this.openDashboard(`${this.getDashboardsFolder()}/${FILENAME_DASHBOARD_ACTIVITY}`),
    });

    this.addCommand({
      id: "open-tags",
      name: "Open Tags Dashboard",
      callback: () => this.openDashboard(`${this.getDashboardsFolder()}/${FILENAME_DASHBOARD_TAGS_VAULT}`),
    });

    this.addCommand({
      id: "open-kanban",
      name: "Open Kanban Board",
      callback: () => this.openDashboard(`${this.getDashboardsFolder()}/${FILENAME_DASHBOARD_KANBAN}`),
    });

    this.addCommand({
      id: "show-status-ui",
      name: "Change Status",
      callback: () => {
        new StatusChangeModal(this.app, this).open();
      }
    });

    this.addSettingTab(new CreationLedgerSettingTab(this.app, this));
  }

  isDataviewAvailable() {
    return !!this.app.plugins.plugins["dataview"];
  }

  async openDashboard(path) {
    if (!this.isDataviewAvailable()) {
      new Notice("Dataview is required for dashboards. Install/enable Dataview and try again.");
      return;
    }
    await openFile(this.app, path);
  }

  async ensureFolder(path) {
    const adapter = this.app.vault.adapter;
    
    // Check actual filesystem, not cache
    if (await adapter.exists(path)) {
      return;
    }

    try {
      await this.app.vault.createFolder(path);
    } catch (e) {
      // Safely ignore "already exists" errors
      if (!e.message?.includes("already exists")) {
        console.warn(`Could not create folder ${path}:`, e);
      }
    }
  }

  async ensureFolders() {
    await this.ensureFolder(this.settings.rootFolder);
    await this.ensureFolder(`${this.settings.rootFolder}/${FOLDER_DASHBOARDS}`);
    await this.ensureFolder(`${this.settings.rootFolder}/${this.settings.archiveFolderName}`);
  }

  async ensureRegistries() {
    const bundledRegistriesPath = getBundledRegistriesPath(this.app);
    
    await copyBundledFileIfMissing(this.app, this.getProjectsRegistry(), `${bundledRegistriesPath}/${FILENAME_PROJECTS_REGISTRY}`);
    await copyBundledFileIfMissing(this.app, this.getStatusesRegistry(), `${bundledRegistriesPath}/${FILENAME_STATUSES_REGISTRY}`);
    await copyBundledFileIfMissing(this.app, this.getTagsRegistry(), `${bundledRegistriesPath}/${FILENAME_TAGS_REGISTRY}`);
    await copyBundledFileIfMissing(this.app, this.getActionsRegistry(), `${bundledRegistriesPath}/${FILENAME_ACTIONS_REGISTRY}`);
    await copyBundledFileIfMissing(this.app, this.getDeliverablesRegistry(), `${bundledRegistriesPath}/${FILENAME_DELIVERABLES_REGISTRY}`);
  }

  async ensureDashboards() {
    const bundledDashboardsPath = getBundledDashboardsPath(this.app);
    
    await copyBundledFileIfMissing(this.app, `${this.getDashboardsFolder()}/${FILENAME_DASHBOARD_KANBAN}`, `${bundledDashboardsPath}/${FILENAME_DASHBOARD_KANBAN}`);
    await copyBundledFileIfMissing(this.app, `${this.getDashboardsFolder()}/${FILENAME_DASHBOARD_TODAY}`, `${bundledDashboardsPath}/${FILENAME_DASHBOARD_TODAY}`);
    await copyBundledFileIfMissing(this.app, `${this.getDashboardsFolder()}/${FILENAME_DASHBOARD_ACTIVITY}`, `${bundledDashboardsPath}/${FILENAME_DASHBOARD_ACTIVITY}`);
    await copyBundledFileIfMissing(this.app, `${this.getDashboardsFolder()}/${FILENAME_DASHBOARD_TAGS_VAULT}`, `${bundledDashboardsPath}/${FILENAME_DASHBOARD_TAGS}`);
  }

  async loadRegistries() {
    await this.loadProjects();
    await this.loadStatuses();
    await this.loadTagSuggestions();
    await this.loadActions();
    await this.loadDeliverables();
  }

  async loadProjects() {
    const file = this.app.vault.getAbstractFileByPath(this.getProjectsRegistry());
    if (file instanceof TFile) {
      this.projects = readRegistryList(await this.app.vault.read(file));
    } else {
      this.projects = [];
    }
  }

  async loadStatuses() {
    const file = this.app.vault.getAbstractFileByPath(this.getStatusesRegistry());
    if (file instanceof TFile) {
      this.statuses = readRegistryList(await this.app.vault.read(file));
    } else {
      this.statuses = [];
    }
  }

  async loadTagSuggestions() {
    const file = this.app.vault.getAbstractFileByPath(this.getTagsRegistry());
    if (file instanceof TFile) {
      this.tagSuggestions = readRegistryList(await this.app.vault.read(file));
    } else {
      this.tagSuggestions = [];
    }
  }

  async loadActions() {
    const file = this.app.vault.getAbstractFileByPath(this.getActionsRegistry());
    if (file instanceof TFile) {
      this.actions = readRegistryList(await this.app.vault.read(file));
    } else {
      this.actions = [];
    }
  }

  async loadDeliverables() {
    const file = this.app.vault.getAbstractFileByPath(this.getDeliverablesRegistry());
    if (file instanceof TFile) {
      this.deliverables = readRegistryList(await this.app.vault.read(file));
    } else {
      this.deliverables = [];
    }
  }

  // =====================
  // Status Mutation API
  // =====================
  /**
   * Resolve target file from explicit file or active file.
   * @param {TFile} explicitFile - Optional explicit file to use
   * @returns {TFile|null} - Resolved file or null if none found
   */
  resolveTargetFile(explicitFile) {
    // 1. Explicit file always wins
    if (explicitFile && explicitFile.path) {
      return explicitFile;
    }

    // 2. Fall back to active file
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile) {
      return activeFile;
    }

    // 3. Nothing to act on
    new Notice("No active file to update");
    return null;
  }

  /**
   * Set the status frontmatter field for a given file.
   * Single source of truth for status mutation.
   * @param {TFile} file - The file to update
   * @param {string} newStatus - The new status value
   */
  async setStatusForFile(file, newStatus) {
    // Basic runtime validation
    if (!file || !file.path) {
      new Notice("Invalid file");
      return;
    }

    if (!newStatus || typeof newStatus !== "string") {
      new Notice("Invalid status value");
      return;
    }

    // Ensure statuses registry is loaded
    if (!this.statuses || this.statuses.length === 0) {
      await this.loadStatuses();
    }

    // Case-insensitive registry validation
    const matchedStatus = this.statuses.find(
      (s) => s.toLowerCase() === newStatus.toLowerCase()
    );

    if (!matchedStatus) {
      new Notice(`Status "${newStatus}" is not in ${FILENAME_STATUSES_REGISTRY}. Edit the statuses registry to add it.`);
      return;
    }

    try {
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        fm.status = matchedStatus;
      });

      new Notice(`Status set to "${matchedStatus}"`);
    } catch (err) {
      console.error("Failed to update status", err);
      new Notice("Failed to update status");
    }
  }

  /**
   * Render a status dropdown bound to a target file.
   * Falls back to the active file if none is provided.
   * @param {Object} options - Options object
   * @param {HTMLElement} options.container - Container element to render into
   * @param {TFile} [options.file] - Optional explicit file to target
   */
  async renderStatusDropdown(options) {
    const container = options && options.container;
    const explicitFile = options && options.file;

    if (!container) {
      console.warn("renderStatusDropdown: missing container");
      return;
    }

    // Resolve file (explicit → active)
    const file = this.resolveTargetFile(explicitFile);
    if (!file) {
      container.createEl("em", { text: "No file selected" });
      return;
    }

    // Ensure statuses are loaded
    if (!this.statuses || this.statuses.length === 0) {
      await this.loadStatuses();
    }

    // If still no statuses, use defaults
    const statusesToUse = this.statuses && this.statuses.length > 0 
      ? this.statuses 
      : ["todo", "in-progress", "blocked", "done", "paused"];

    // Read current status from frontmatter
    let currentStatus = "";
    try {
      const cache = this.app.metadataCache.getFileCache(file);
      currentStatus = cache?.frontmatter?.status || "";
    } catch (e) {
      console.warn("Could not read frontmatter", e);
    }

    // Build UI
    const wrapper = container.createDiv({ cls: "creationledger-status-dropdown" });

    const label = wrapper.createEl("label", { text: "Status" });
    label.style.display = "block";
    label.style.fontSize = "0.8em";
    label.style.marginBottom = "0.25em";

    const select = wrapper.createEl("select");
    select.style.width = "100%";

    // Populate options
    statusesToUse.forEach((status) => {
      const option = select.createEl("option", {
        value: status,
        text: status
      });

      if (
        currentStatus &&
        status.toLowerCase() === currentStatus.toLowerCase()
      ) {
        option.selected = true;
      }
    });

    // Change handler
    select.addEventListener("change", async (e) => {
      const newStatus = e.target.value;
      await this.setStatusForFile(file, newStatus);
    });
  }

  async createCreationLedger({ title, project, status, category, action, deliverable, tags, notes }) {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    const seconds = String(now.getSeconds()).padStart(2, "0");
    const milliseconds = String(now.getMilliseconds()).padStart(3, "0");

    const dateFolder = `${this.settings.rootFolder}/${year}/${month}/${day}`;
    const adapter = this.app.vault.adapter;

    // Ensure date folder chain
    await this.ensureFolder(`${this.settings.rootFolder}/${year}`);
    await this.ensureFolder(`${this.settings.rootFolder}/${year}/${month}`);
    await this.ensureFolder(dateFolder);

    const dateStr = `${year}-${month}-${day}`;
    const timeStr = `${hours}:${minutes}:${seconds}`;
    const datetimeStr = `${dateStr}T${hours}:${minutes}:${seconds}`;

    const sanitizedTitle = sanitizeFilename(title);
    // Format: YYYY-MM-DD HH_MM_SS title.md 
    let filename = `${dateStr} ${hours}_${minutes}_${seconds} ${sanitizedTitle}.md`;
    let filePath = `${dateFolder}/${filename}`;

    let counter = 1;
    while (await adapter.exists(filePath)) {
      // Fallback if somehow file still exists
      filename = `${dateStr} ${hours}_${minutes}_${seconds} ${sanitizedTitle} (${counter}).md`;
      filePath = `${dateFolder}/${filename}`;
      counter++;
    }

    // Build frontmatter with all state fields
    const frontmatterFields = [
      `type: ${this.settings.frontmatterType}`,
      `date: ${dateStr}`,
      `time: ${timeStr}`,
      `datetime: ${datetimeStr}`,
    ];

    if (project) frontmatterFields.push(`project: ${project}`);
    if (status) frontmatterFields.push(`status: ${status}`);
    if (category) frontmatterFields.push(`category: ${category}`);
    if (action) frontmatterFields.push(`action: ${action}`);
    if (deliverable) frontmatterFields.push(`deliverable: ${deliverable}`);

    const frontmatter = `---\n${frontmatterFields.join("\n")}\n---\n\n`;

    // Tags in BODY only - using #tag/<slug> format
    const uniqueTags = [...new Set(tags || [])];
    const tagParts = uniqueTags
      .filter((t) => t)
      .map((t) => `#tag/${t}`);

    let body = "";
    if (tagParts.length > 0) {
      body += tagParts.join(" ") + "\n";
    }

    if (notes && notes.trim()) {
      if (body) body += "\n";
      body += notes.trim() + "\n";
    }

    await this.app.vault.create(filePath, frontmatter + body);

    new Notice(`Creation ledger created: ${filename}`);

    const created = this.app.vault.getAbstractFileByPath(filePath);
    if (created instanceof TFile) {
      await this.app.workspace.openLinkText(filePath, "", true);
    }
  }
};
