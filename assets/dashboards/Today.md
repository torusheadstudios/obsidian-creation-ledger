
```dataviewjs
const plugin = app.plugins.plugins["creation-ledger"];

if (!plugin || !plugin.constants) {
  dv.paragraph("Creation Ledger plugin is not available.");
} else {
  const {
    ROOT_FOLDER
  } = plugin.constants;

  const today = dv.date("today");
  const todayPages = dv.pages(`"${ROOT_FOLDER}"`)
    .where(p => p.date && dv.date(p.date).equals(today))
    .sort(p => p.datetime, "asc");

  dv.table(
    ["Note", "datetime", "project", "status", "Tags"],
    todayPages.map(p => [
      p.file.link,
      p.datetime ?? "",
      p.project ?? "",
      p.status ?? "",
      (p.file.tags ?? []).join(", ")
    ])
  );
}
```

