const editableFields = [
  "title",
  "notes",
  "projectId",
  "priority",
  "dueAt",
  "reminderAt",
  "completed",
];

// Send only the changes the user made. A live scheduler may have advanced runAt
// while this editor was open; saving a note must not replay the previous run.
export function taskPayload(original, edited) {
  const payload = {};
  for (const key of editableFields) {
    const value = key === "title" ? edited.title.trim() : edited[key];
    if (!original.id || value !== original[key]) payload[key] = value;
  }
  const automation = {};
  for (const key of [
    "enabled",
    "prompt",
    "workspace",
    "runAt",
    "repeat",
    "sandbox",
  ]) {
    if (!original.id || edited.automation[key] !== original.automation?.[key]) {
      automation[key] = edited.automation[key];
    }
  }
  if (Object.keys(automation).length) payload.automation = automation;
  return payload;
}
