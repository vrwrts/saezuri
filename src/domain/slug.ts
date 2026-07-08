// The canonical species key rule, identical to AvianVisitors' so the reused
// asset filenames line up: lowercase, collapse any run of non-alphanumerics to
// a single hyphen, trim leading/trailing hyphens.
//   "Calypte anna" -> "calypte-anna"
export function slugify(scientificName: string): string {
  return scientificName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}
