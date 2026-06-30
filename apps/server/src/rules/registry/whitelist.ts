import { CLIENT_KINDS, type AllowRule } from "../types";

/* Plans/Rules Matrix — Section 1 (Whitelist), 6 layers verbatim.
 * Any connection not listed is FORBIDDEN by default (default deny). */
export const WHITELIST: AllowRule[] = [
  // 1. Client and External Access Layer (Client & Ingress)
  { source: CLIENT_KINDS, edge: "REQUESTS", target: ["APIGateway", "Controller"], layer: "client",
    note: "Request to the main entry gateway / directly to the API." },
  { source: CLIENT_KINDS, edge: "USES", target: "DTO", layer: "client",
    note: "Clients must know the DTO structure when sending data to the API." },
  { source: "APIGateway", edge: "ROUTES_TO", target: "Controller", layer: "client",
    note: "Routes requests to the relevant microservice." },

  // 2. Processing and Presentation Layer (Presentation & Handling)
  { source: "Controller", edge: "CALLS", target: ["Service", "Orchestrator"], layer: "presentation",
    note: "Starts the Core Business Logic or Saga flow." },
  { source: "Controller", edge: "USES", target: "DTO", layer: "presentation",
    note: "Request/Response schemas are bound." },
  { source: "Controller", edge: "RETURNS", target: "DTO", layer: "presentation",
    note: "Only DTOs are exposed outward (not Model/Entity)." },
  { source: "Controller", edge: "THROWS", target: "Exception", layer: "presentation",
    note: "Throws HTTP error codes." },
  { source: "Middleware", edge: "ROUTES_TO", target: "Controller", layer: "presentation",
    note: "Continues the pipeline." },

  // 3. Business Logic Layer (Business Logic)
  { source: "Service", edge: "CALLS", target: ["Repository", "Service"], layer: "business",
    note: "DB operations go through the Repository; service-to-service calls are allowed (must not be circular — ERR_COND_001)." },
  { source: "Service", edge: "REQUESTS", target: "ExternalService", layer: "business",
    note: "External services (Stripe, AWS) are called." },
  { source: "Service", edge: "PUBLISHES", target: "MessageQueue", layer: "business",
    note: "Asynchronous event emission." },
  { source: "Service", edge: "CACHES_IN", target: "Cache", layer: "business",
    note: "Write frequently used data to Redis/Memcached." },
  { source: "Service", edge: "USES", target: "Model", layer: "business",
    note: "Business rules are executed on the Model." },
  { source: "Service", edge: "RETURNS", target: ["DTO", "Model"], layer: "business",
    note: "Both are allowed depending on the architectural choice." },
  { source: "Service", edge: "THROWS", target: "Exception", layer: "business",
    note: "Business rule violation → exception." },
  { source: "Service", edge: "READS_CONFIG", target: "EnvironmentVariable", layer: "business",
    note: "Settings such as API Key, DB URL, etc." },

  // 4. Arka Plan ve Asenkron (Background & Event-Driven)
  { source: "Worker", edge: "CALLS", target: "Service", layer: "background",
    note: "Triggers the service when the cron time arrives." },
  { source: "EventHandler", edge: "SUBSCRIBES", target: "MessageQueue", layer: "background",
    note: "Points to the queue it listens to." },
  { source: "EventHandler", edge: "CALLS", target: "Service", layer: "background",
    note: "Notifies the service when the event occurs." },
  { source: "Orchestrator", edge: "CALLS", target: "Service", layer: "background",
    note: "Coordinates multiple services in the Saga pattern." },

  // 5. Data Access Layer (Data Access)
  { source: "Repository", edge: "QUERIES", target: ["Table", "View"], layer: "data",
    note: "SELECT operation (empty-table warning: WARN_COND_001)." },
  { source: "Repository", edge: "WRITES", target: "Table", layer: "data",
    note: "INSERT/UPDATE/DELETE." },
  { source: "Repository", edge: "USES", target: "Model", layer: "data",
    note: "Maps raw data from the DB to the Model (ORM)." },
  { source: "Repository", edge: "RETURNS", target: "Model", layer: "data",
    note: "Exposes the Model outward (not a DTO)." },
  { source: "Repository", edge: "THROWS", target: "Exception", layer: "data",
    note: "UniqueConstraint and other DB errors." },

  // 6. Data, Schema and Inheritance (Schema & Inheritance)
  { source: "Model", edge: "HAS", target: "Model", layer: "schema",
    note: "Composition: Order HAS OrderItem." },
  { source: "Model", edge: "EXTENDS", target: "Model", layer: "schema",
    note: "Class inheritance: AdminUser EXTENDS BaseUser." },
  { source: "Model", edge: "USES", target: "Enum", layer: "schema",
    note: "Status codes, etc." },
  { source: "Model", edge: "USES", target: "Table", layer: "schema",
    note: "ORM mapping — the physical Table corresponding to the Model." },
  { source: "DTO", edge: "HAS", target: "DTO", layer: "schema",
    note: "Nested DTO." },
  { source: "DTO", edge: "USES", target: "Enum", layer: "schema",
    note: "Validation and type determination." },
  { source: "Table", edge: "USES", target: "Enum", layer: "schema",
    note: "ENUM columns at the DB level." },
  { source: "Exception", edge: "EXTENDS", target: "Exception", layer: "schema",
    note: "NotFoundError EXTENDS BaseError." },
  { source: "Service", edge: "IMPLEMENTS", target: "Service", layer: "schema",
    note: "A service implements another service acting as an interface/contract (PaymentService IMPLEMENTS IPaymentService). Since there is no separate Interface node type, the interface is also modeled as a Service." },

  // 7. UI Composition (Frontend)
  { source: "FrontendApp", edge: "HAS", target: "UIComponent", layer: "client",
    note: "The frontend app contains pages/components." },
  { source: "UIComponent", edge: "HAS", target: "UIComponent", layer: "client",
    note: "Nested component composition: PageLayout HAS Header/Sidebar." },

  // 8. Modular Architecture (Bounded Context)
  { source: "Module", edge: "DEPENDS_ON", target: "Module", layer: "structure",
    note: "Module hierarchy — bounded context dependency graph." },
  { source: "Module", edge: "USES", target: "Service", layer: "structure",
    note: "Services exposed by the Module (public API surface)." },

  // 9. Schema (parameter/format) references
  { source: "Service", edge: "USES", target: "DTO", layer: "business",
    note: "Method parameter or nested DTO reference." },
  { source: "MessageQueue", edge: "USES", target: "DTO", layer: "background",
    note: "Message format DTO reference." },
];
