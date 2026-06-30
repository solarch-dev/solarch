/** Field key → semantic lucide icon mapping.
 *  Each field gets its own icon on the Inspector DrawerTrigger buttons. */

import {
  Code2, FileText, Sparkles, Settings, Globe, Columns3,
  Package, Activity, Tag, AlertTriangle, Hash, Variable,
  FileCode, ShieldCheck, Key, Lock, Link2, Workflow,
  Boxes, Send, Inbox, GitBranch, Component, Layers,
  ListTree, Database, Network, Filter, Clock, Bell,
  type LucideIcon,
} from "lucide-react";

/** General pattern: field name → semantic icon. Case-insensitive lookup + substring match. */
const FIELD_ICON_MAP: Record<string, LucideIcon> = {
  // Behavior / code
  Methods: Code2,
  Functions: Code2,
  Operations: Code2,
  Actions: Workflow,
  Handlers: Workflow,
  Hooks: Workflow,
  Lifecycle: Workflow,

  // HTTP / Network
  Endpoints: Network,
  Routes: Globe,
  RoutesTo: Globe,
  Targets: Globe,
  ExternalCalls: Globe,
  Requests: Send,

  // UI / pages
  Pages: FileText,
  Screens: FileText,
  Layouts: Layers,
  Views: FileText,
  Components: Component,
  Children: Component,
  Slots: Component,
  Sections: Layers,

  // Properties / fields
  Properties: Tag,
  Props: Tag,
  Attributes: Tag,
  Fields: Columns3,
  Columns: Columns3,
  Parameters: Variable,
  Params: Variable,
  Args: Variable,
  Arguments: Variable,
  Inputs: Variable,
  Outputs: Variable,

  // Data / schema
  Values: Hash,
  EnumValues: Hash,
  Constants: Hash,
  Items: ListTree,
  Entries: ListTree,
  Schema: Columns3,
  Schemas: Columns3,
  Type: Tag,
  Types: Tag,

  // Constraints / keys / index
  PrimaryKey: Key,
  PrimaryKeys: Key,
  ForeignKeys: Link2,
  References: Link2,
  Relations: Link2,
  Indexes: Database,
  UniqueConstraints: Lock,
  CheckConstraints: ShieldCheck,
  Constraints: ShieldCheck,
  Validators: ShieldCheck,
  ValidationRules: ShieldCheck,
  Rules: ShieldCheck,
  Policies: ShieldCheck,

  // Config / settings
  Config: Settings,
  Configuration: Settings,
  Settings: Settings,
  Options: Settings,
  Preferences: Settings,
  EnvVars: Variable,
  EnvironmentVariables: Variable,
  Variables: Variable,
  Secrets: Lock,
  Credentials: Lock,

  // Capabilities / dependencies
  Features: Sparkles,
  Capabilities: Sparkles,
  Permissions: ShieldCheck,
  Dependencies: Package,
  Imports: Package,
  Exports: Package,
  Modules: Boxes,
  Submodules: Boxes,
  Packages: Package,

  // Errors / exceptions
  Throws: AlertTriangle,
  Errors: AlertTriangle,
  Exceptions: AlertTriangle,
  ErrorHandlers: AlertTriangle,

  // Async / messaging
  Publishers: Send,
  Publishes: Send,
  Subscribers: Inbox,
  Subscribes: Inbox,
  Topics: Inbox,
  Queues: Inbox,
  Channels: Inbox,
  Events: Bell,
  Triggers: Bell,
  Notifications: Bell,

  // State / lifecycle
  State: Activity,
  States: Activity,
  Status: Activity,
  Transitions: GitBranch,
  Steps: Workflow,
  Stages: Workflow,
  Phases: Workflow,
  Flow: Workflow,
  Workflow: Workflow,

  // Scheduling
  Schedule: Clock,
  Schedules: Clock,
  Cron: Clock,
  Timing: Clock,

  // HTTP body / headers
  Body: FileCode,
  Headers: FileCode,
  Cookies: FileCode,
  QueryParams: FileCode,

  // Filtering / sorting
  Filters: Filter,
  Sort: Filter,
  Sorters: Filter,

  // Misc
  Tags: Tag,
  Labels: Tag,
  Metadata: Tag,
};

/** Returns the matching lucide icon component for a field key. Falls back to ListTree if not found. */
export function getFieldIcon(fieldKey: string): LucideIcon {
  // 1) Exact match (camelCase)
  if (FIELD_ICON_MAP[fieldKey]) return FIELD_ICON_MAP[fieldKey];

  // 2) Case-insensitive exact
  const lower = fieldKey.toLowerCase();
  for (const [key, icon] of Object.entries(FIELD_ICON_MAP)) {
    if (key.toLowerCase() === lower) return icon;
  }

  // 3) Substring match — field name "MyMethods" → Methods match
  for (const [key, icon] of Object.entries(FIELD_ICON_MAP)) {
    const k = key.toLowerCase();
    if (lower.endsWith(k) || lower.startsWith(k) || lower.includes(k)) {
      return icon;
    }
  }

  // 4) Fallback
  return ListTree;
}
