
```dataviewjs
const plugin = app.plugins.plugins["creation-ledger"];

if (!plugin || !plugin.constants) {
  dv.paragraph("Creation Ledger plugin is not available.");
} else {
  const {
    ROOT_FOLDER,
    ARCHIVE_FOLDER,
    FRONTMATTER_TYPE,
    TAG_PREFIX,
    CSS,
    UI
  } = plugin.constants;

  // ---------------------
  // Helpers
  // ---------------------
  function getAllPages() {
    return dv.pages(`"${ROOT_FOLDER}"`).where(p =>
      p.type === FRONTMATTER_TYPE &&
      !p.file.path.startsWith(`${ROOT_FOLDER}/${ARCHIVE_FOLDER}/`)
    );
  }

  // ---------------------
  // Load data
  // ---------------------
  let allPages = getAllPages();

  // Distinct filter values
  const projects = [...new Set(allPages.map(p => p.project).filter(Boolean))].sort();
  const statuses = [...new Set(allPages.map(p => p.status).filter(Boolean))].sort();
  const categories = [...new Set(allPages.map(p => p.category).filter(Boolean))].sort();

  // ---------------------
  // Filter UI
  // ---------------------
  const filterContainer = dv.container.createDiv({ cls: CSS.FILTERS });
  filterContainer.style.display = "flex";
  filterContainer.style.gap = "0.75em";
  filterContainer.style.marginBottom = "1em";

  // Project filter
  const projectSelect = filterContainer.createEl("select");
  projectSelect.createEl("option", { text: "All Projects", value: "" });
  projects.forEach(p => projectSelect.createEl("option", { text: p, value: p }));

  // Status filter
  const statusSelect = filterContainer.createEl("select");
  statusSelect.createEl("option", { text: "All Statuses", value: "" });
  statuses.forEach(s => statusSelect.createEl("option", { text: s, value: s }));

  // Category filter
  const categorySelect = filterContainer.createEl("select");
  categorySelect.createEl("option", { text: "All Categories", value: "" });
  categories.forEach(c => categorySelect.createEl("option", { text: c, value: c }));

  // Reset button
  const resetButton = filterContainer.createEl("button", { text: "Reset" });
  resetButton.style.padding = "0.4em 0.8em";
  resetButton.style.border = "1px solid var(--background-modifier-border)";
  resetButton.style.borderRadius = "4px";
  resetButton.style.backgroundColor = "var(--background-primary)";
  resetButton.style.color = "var(--text-normal)";
  resetButton.style.cursor = "pointer";
  resetButton.style.fontSize = "0.9em";

  // ---------------------
  // Results container
  // ---------------------
  const resultsContainer = dv.container.createDiv({ cls: CSS.RESULTS });

  // ---------------------
  // Filtering + rendering
  // ---------------------
  function resetFilters() {
    projectSelect.value = "";
    statusSelect.value = "";
    categorySelect.value = "";
  }

  function getFilteredPages() {
    let filtered = allPages;

    if (projectSelect.value) {
      filtered = filtered.where(p => p.project === projectSelect.value);
    }

    if (statusSelect.value) {
      filtered = filtered.where(p => p.status === statusSelect.value);
    }

    if (categorySelect.value) {
      filtered = filtered.where(p => p.category === categorySelect.value);
    }

    return filtered.sort(p => p.datetime, "desc");
  }

  function renderResults() {
    resultsContainer.empty();

    const rows = getFilteredPages();

    if (rows.length === 0) {
      resultsContainer.createEl("em", { text: "No matching activities." });
      return;
    }

    const table = resultsContainer.createEl("table");
    const thead = table.createEl("thead");
    const headerRow = thead.createEl("tr");
    ["Date", "Note", "Project", "Status", "Category", "Action"].forEach(header => {
      headerRow.createEl("th", { text: header });
    });

    const tbody = table.createEl("tbody");
    rows.forEach(p => {
      const row = tbody.createEl("tr");
      
      // Date
      row.createEl("td", { text: p.date ?? "" });
      
      // Note (file link)
      const noteCell = row.createEl("td");
      if (p.file) {
        const link = noteCell.createEl("a", { 
          text: p.file.name.replace(/\.md$/, ""),
          href: p.file.path
        });
        link.addEventListener("click", (e) => {
          e.preventDefault();
          app.workspace.openLinkText(p.file.path, "", true);
        });
      }
      
      // Project
      row.createEl("td", { text: p.project ?? "" });
      
      // Status
      row.createEl("td", { text: p.status ?? "" });
      
      // Category
      row.createEl("td", { text: p.category ?? "" });
      
      // Action
      row.createEl("td", { text: p.action ?? "" });
    });
  }

  // ---------------------
  // Initial render + events
  // ---------------------
  renderResults();

  projectSelect.addEventListener("change", renderResults);
  statusSelect.addEventListener("change", renderResults);
  categorySelect.addEventListener("change", renderResults);
  resetButton.addEventListener("click", () => {
    resetFilters();
    renderResults();
  });
}
```
