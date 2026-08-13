// Hand-rolled rather than a schema library (zod, ajv, ...) — this repo
// deliberately stays dependency-light, and the shape is small and stable
// enough that a plain function is easier to read than a schema DSL.
//
// Runs once at module load (see _profile.js), so a malformed profile.json
// fails loudly and immediately — in dev that's an error the moment the
// server starts; in production it's a clear cold-start crash in Vercel
// logs, not an agent that silently tells visitors "undefined" about their
// own work experience.
function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

export function validateProfile(profile) {
  const errors = [];
  const require = (condition, path) => {
    if (!condition) errors.push(path);
  };

  require(isNonEmptyString(profile?.name), 'name');
  require(isNonEmptyString(profile?.location), 'location');
  require(isNonEmptyString(profile?.resumeUrl), 'resumeUrl');
  require(isNonEmptyString(profile?.summary), 'summary');
  require(isNonEmptyString(profile?.availability), 'availability');
  require(isNonEmptyString(profile?.personal), 'personal');

  require(isNonEmptyString(profile?.contact?.phone), 'contact.phone');
  require(isNonEmptyString(profile?.contact?.linkedin), 'contact.linkedin');
  require(isNonEmptyString(profile?.contact?.github), 'contact.github');

  require(Array.isArray(profile?.workExperience) && profile.workExperience.length > 0, 'workExperience');
  (profile?.workExperience ?? []).forEach((entry, i) => {
    require(isNonEmptyString(entry?.company), `workExperience[${i}].company`);
    require(isNonEmptyString(entry?.title), `workExperience[${i}].title`);
    require(isNonEmptyString(entry?.dates), `workExperience[${i}].dates`);
    require(Array.isArray(entry?.highlights) && entry.highlights.length > 0, `workExperience[${i}].highlights`);
  });

  require(Array.isArray(profile?.education) && profile.education.length > 0, 'education');
  (profile?.education ?? []).forEach((entry, i) => {
    require(isNonEmptyString(entry?.degree), `education[${i}].degree`);
    require(isNonEmptyString(entry?.school), `education[${i}].school`);
    require(isNonEmptyString(entry?.dates), `education[${i}].dates`);
    require(isNonEmptyString(entry?.coursework), `education[${i}].coursework`);
    // gpa is genuinely optional (not every degree has one worth listing) —
    // null is the explicit "no GPA" value, not a missing field.
    require(entry?.gpa === null || isNonEmptyString(entry?.gpa), `education[${i}].gpa (use null, not "" or undefined)`);
  });

  require(
    profile?.skills && typeof profile.skills === 'object' && Object.keys(profile.skills).length > 0,
    'skills'
  );
  Object.entries(profile?.skills ?? {}).forEach(([category, items]) => {
    require(Array.isArray(items) && items.length > 0, `skills.${category}`);
  });

  require(Array.isArray(profile?.projects) && profile.projects.length > 0, 'projects');
  (profile?.projects ?? []).forEach((entry, i) => {
    require(isNonEmptyString(entry?.name), `projects[${i}].name`);
    require(isNonEmptyString(entry?.description), `projects[${i}].description`);
  });

  if (errors.length > 0) {
    throw new Error(
      `profile.json is missing or has invalid values for: ${errors.join(', ')}. ` +
      `Check profile.json against the schema in README.md.`
    );
  }
}
