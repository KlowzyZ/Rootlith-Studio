import { instantiateLocalTemplate } from "./local-kits";
import { newTask } from "./action-plan";
import { starter } from "./starters";
import { caseSchema, putCase, type InvestigationCase } from "./cases";
import { putWorkflow, storeSchema, type Store } from "./storage";
import { workflowSchema, type Workflow } from "../schemas";

// Authored guidance wraps the existing starter graphs; there is one execution engine.
export const investigationKits = [
  {
    key: "camera",
    name: "IP camera / NVR reachability",
    audience: "CCTV · device management",
    intent:
      "Check the path to one known device and its documented management service before investigating recording or video.",
    prerequisites:
      "Obtain the authorized device address, documented TCP service port and optional HTTP(S) management URL from site records. Confirm cabling, PoE and network segment with the site administrator.",
    configuration:
      "DNS/TCP host, documented TCP port, and HTTP(S) base URL if used. For a literal IP, choose the skip-DNS branch. All targets start blank.",
    limitations:
      "No discovery, vendor default ports, credentials, RTSP, ONVIF, streaming or recording checks. The native scope review includes every configured diagnostic node, even optional branches.",
    interpretation:
      "A reachable port is not proof of camera health. Management HTTP does not establish recording, storage or authentication health. Compare evidence with device logs using your normal authorized tools.",
  },
  {
    key: "network",
    name: "LAN / workstation connectivity",
    audience: "LAN · desktop support",
    intent:
      "Review local adapter context, resolve one configured host and test one known service endpoint.",
    prerequisites:
      "Identify the expected LAN segment and one authorized service address and port. Record symptoms and whether other devices are affected before checking.",
    configuration:
      "DNS/TCP host, TCP service port and optional HTTP(S) base URL. All targets start blank; no network range is accepted.",
    limitations:
      "Adapter addresses do not prove internet access. DNS uses IPv4 lookup; literal IP or IPv6-only names may not provide useful DNS evidence. No ping sweep, route discovery or configuration changes.",
    interpretation:
      "Separate adapter context, name resolution and service reachability. A failed TCP check alone cannot distinguish routing, firewall or service faults. Save a baseline before making an intentional change.",
  },
  {
    key: "service",
    name: "Local service / self-hosted web app",
    audience: "Service desk · self-hosted services",
    intent:
      "Separate a listening TCP port from a usable HTTP response on one authorized service, including local services.",
    prerequisites:
      "Confirm the actual bind address and port from the service configuration. Obtain an authorized HTTP(S) endpoint and expected status from the service owner; do not assume localhost or a default port.",
    configuration:
      "TCP host and port, plus HTTP(S) base URL if applicable. Inspect the HTTP step to set a specific path. All targets start blank.",
    limitations:
      "HTTP HEAD only: no credentials, bodies, redirects or application transactions. Non-HTTP protocols cannot be tested using HEAD. No service restart, script execution or settings changes.",
    interpretation:
      "TCP reachability and HTTP status answer different questions. HTTP 405 may mean HEAD is unsupported; failed and inconclusive results remain distinct. Compare recorded statuses and service logs rather than inferring root cause.",
  },
] as const;
export type InvestigationKit = (typeof investigationKits)[number];
export function kitByKey(key: string): InvestigationKit {
  const kit = investigationKits.find((k) => k.key === key);
  if (!kit) throw Error("Unknown investigation kit.");
  return kit;
}
export type KitDraft = { workflow: Workflow; investigation: InvestigationCase };
export function prepareKit(
  key: string,
  name: string,
  profileId?: string,
): KitDraft {
  const kit = kitByKey(key);
  const workflow = workflowSchema.parse(starter(key));
  const now = new Date().toISOString();
  const investigation = caseSchema.parse({
    id: crypto.randomUUID(),
    name,
    profileId,
    note: `Investigation kit: ${kit.name}\n\nPrerequisites: ${kit.prerequisites}\n\nNext steps: Open the linked playbook and use Quick Target Setup. Review exact target changes before applying (Undo/Redo available). Review native execution scope before running. Save the report, attach it to this case, then compare later runs or export a reviewed case dossier.\n\nInterpretation: ${kit.interpretation}\n\nLimitations: ${kit.limitations}\n\nTechnician observations:`,
    workflowIds: [workflow.id],
    runIds: [],
    actionPlan: [
      newTask(
        "Confirm authorization and record the reported symptom",
        "Human guidance only; no check has been performed.",
        "",
        true,
      ),
      newTask(
        "Verify the documented device/service address and port",
        "Review site records before configuring targets.",
        "",
        true,
      ),
      newTask(
        "Review approved evidence and record the next visit or handover",
        "Running diagnostics never checks this task automatically.",
        "",
        true,
      ),
    ],
    archived: false,
    created: now,
    updated: now,
  });
  return { workflow, investigation };
}
// Called inside the serialized writer against the latest acknowledged workspace.
// Both records validate before the single primary record mutation / native ACK.
export function addKit(current: Store, draft: KitDraft): Store {
  const workflow = workflowSchema.parse(draft.workflow);
  const investigation = caseSchema.parse(draft.investigation);
  if (
    investigation.workflowIds.length !== 1 ||
    investigation.workflowIds[0] !== workflow.id ||
    investigation.runIds.length
  )
    throw Error(
      "Kit must create exactly one linked workflow and no run artifacts.",
    );
  if (
    current.cases?.some((c) => c.id === investigation.id) ||
    current.workflows.some((w) => w.id === workflow.id) ||
    current.cases?.some((c) => c.workflowIds.includes(workflow.id)) ||
    Object.values(current.runWorkflows || {}).includes(workflow.id)
  )
    throw Error(
      "Kit identifiers already exist or are reserved by local references. Reopen the kit preview and try again.",
    );
  if (
    investigation.profileId &&
    !current.targetProfiles?.some((p) => p.id === investigation.profileId)
  )
    throw Error(
      "The selected contextual profile is no longer available. Choose a current profile or none.",
    );
  return storeSchema.parse({
    ...current,
    workflows: putWorkflow(current.workflows, workflow),
    cases: putCase(current.cases || [], investigation),
  });
}

export function prepareFromLocalKit(
  source: Workflow,
  name: string,
  profileId?: string,
): KitDraft {
  const workflow = instantiateLocalTemplate(source);
  const base = prepareKit("service", name, profileId);
  const investigation = caseSchema.parse({
    ...base.investigation,
    workflowIds: [workflow.id],
    note: `Local technician kit: ${source.name}\n\nPrerequisites / human guidance: ${source.description}\n\nConfigure the actual targets and HTTP path explicitly. Review native scope before execution. These tasks are human guidance, not proof of checks performed.\n\nTechnician observations:`,
  });
  return { workflow, investigation };
}
