/** The lookups that name a new canvas. The app passes kagan; tests pass fakes. */
export type NamePorts = {
  thread(id: string): Promise<{ projectId: string }>;
  project(id: string): Promise<{ name: string }>;
  projects(): Promise<{ id: string; name: string }[]>;
};

const slug = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "canvas";

/**
 * The canvas a new thread opens on: the project's name as a slug, or "canvas" with no thread.
 * A project that is not in the project list is the personal project, whose id is the name.
 * Any other failure is real and is raised, so a lookup problem cannot quietly pick a new canvas.
 */
export async function defaultName(threadId: string | undefined, ports: NamePorts): Promise<string> {
  if (threadId === undefined) return "canvas";
  const thread = await ports.thread(threadId);
  try {
    return slug((await ports.project(thread.projectId)).name);
  } catch (cause) {
    const known = await ports.projects();
    if (known.some((project) => project.id === thread.projectId)) throw cause;
    return slug(thread.projectId.replace(/^proj_/, ""));
  }
}
