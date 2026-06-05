import { fileSummary, markdownTable, repoPath, walkFiles, writeArtifact, writeJsonArtifact } from "./lib.mjs";

const companyResearchRoot = repoPath("tuaran-home-page", "research", "companies");
const topicResearchRoot = repoPath("tuaran-home-page", "research", "topics");
const companyFiles = await walkFiles(companyResearchRoot, (file) => file.endsWith(".md"));
const topicFiles = await walkFiles(topicResearchRoot, (file) => file.endsWith(".md"));

const targetSegments = [
  {
    segment: "ERP / enterprise SaaS",
    buyer: "CMO, growth lead, product marketing",
    pitch: "Developer-facing content campaigns around AI-native ERP, workflow automation, and industry cases."
  },
  {
    segment: "AI Agent / RPA",
    buyer: "founder, developer relations, sales enablement",
    pitch: "Technical explainers and creator distribution for agent use cases, demos, and integrations."
  },
  {
    segment: "Developer tools / cloud / API",
    buyer: "DevRel, product marketing, founder",
    pitch: "Hands-on technical content, launch amplification, and benchmark-style posts."
  },
  {
    segment: "Low-code / workflow automation",
    buyer: "growth lead, solution consultant",
    pitch: "Scenario articles that translate abstract automation into concrete business workflows."
  },
  {
    segment: "Cross-border SaaS",
    buyer: "founder, overseas marketing",
    pitch: "Chinese developer audience access and localized technical storytelling."
  }
];

const localCompanySignals = [];
for (const file of companyFiles.slice(-30)) {
  const summary = await fileSummary(file, 220);
  localCompanySignals.push({
    name: summary.title,
    sourcePath: file,
    reason: summary.excerpt
  });
}

const topicSignals = [];
for (const file of topicFiles.filter((item) => /agent|erp|blogger|promotion|cloud|llm|developer|marketing|edge/i.test(item)).slice(-20)) {
  const summary = await fileSummary(file, 180);
  topicSignals.push({
    topic: summary.title,
    sourcePath: file,
    reason: summary.excerpt
  });
}

const leads = localCompanySignals.slice(0, 12).map((item, index) => {
  const segment = targetSegments[index % targetSegments.length];
  return {
    company: item.name,
    segment: segment.segment,
    buyer: segment.buyer,
    fit: index < 4 ? "high" : "medium",
    outreachAngle: segment.pitch,
    evidence: item.sourcePath,
    status: "pending_review"
  };
});

const rows = leads.map((lead, index) => [
  index + 1,
  lead.company,
  lead.segment,
  lead.fit,
  lead.buyer,
  lead.outreachAngle
]);

const report = `# Potential Customer Radar

Status: pending_review

This run uses local research notes as seed signals. A later version can add web search, job posting monitoring, launch/news monitoring, and CRM dedupe.

## Lead Candidates

${markdownTable(["#", "Company", "Segment", "Fit", "Buyer", "Angle"], rows)}

## Segment Playbook

${markdownTable(["Segment", "Buyer", "Pitch"], targetSegments.map((item) => [item.segment, item.buyer, item.pitch]))}

## Topic Signals

${markdownTable(["Topic", "Source"], topicSignals.slice(0, 12).map((item) => [item.topic, item.sourcePath]))}
`;

const csv = [
  "company,segment,fit,buyer,outreach_angle,evidence,status",
  ...leads.map((lead) =>
    [lead.company, lead.segment, lead.fit, lead.buyer, lead.outreachAngle, lead.evidence, lead.status]
      .map((value) => `"${String(value).replaceAll('"', '""')}"`)
      .join(",")
  )
].join("\n");

await writeJsonArtifact("lead-radar.json", {
  generatedAt: new Date().toISOString(),
  targetSegments,
  leads,
  topicSignals
});
await writeArtifact("lead-radar.md", report);
await writeArtifact("lead-radar.csv", `${csv}\n`);
console.log(`Generated ${leads.length} lead candidates.`);
