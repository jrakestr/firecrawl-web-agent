import { describe, it, expect } from "vitest";
import { discoverSkills } from "./discovery";
import { validateSkillContent } from "./parser";
import fs from "fs/promises";
import path from "path";

const SKILL_NAME = "rideco-report-export";

async function loadSkill() {
  const skills = await discoverSkills();
  const skill = skills.find((s) => s.name === SKILL_NAME);
  return { skills, skill };
}

describe("rideco-report-export skill", () => {
  it("is discovered by the skills loader", async () => {
    const { skill } = await loadSkill();
    expect(skill).toBeDefined();
  });

  it("exposes well-formed metadata", async () => {
    const { skill } = await loadSkill();
    expect(skill!.description).toBeTruthy();
    expect(skill!.category).toBe("Operations");
    expect(skill!.directory).toContain(SKILL_NAME);
  });

  it("passes frontmatter validation", async () => {
    const { skill } = await loadSkill();
    const content = await fs.readFile(path.join(skill!.directory, "SKILL.md"), "utf-8");
    const result = validateSkillContent(content);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.slug).toBe(SKILL_NAME);
  });

  it("documents the core export flow so the playbook stays intact", async () => {
    const { skill } = await loadSkill();
    const body = (await fs.readFile(path.join(skill!.directory, "SKILL.md"), "utf-8")).toLowerCase();

    // The redirect workaround, the hidden export path, and the auth guardrail are the
    // load-bearing steps — assert they survive future edits.
    expect(body).toContain("ops.valleymetroconnect.rideco.com");
    expect(body).toContain("/operation-center/reports");
    expect(body).toContain("export data");
    expect(body).toContain("data with current layout");
    expect(body).toContain("savechanges: false");
    expect(body).toContain("2fa");
  });
});
