import { ACTIVE_KINDS, CLIENT_KINDS, PASSIVE_KINDS, type DenyRule } from "../types";

/* Plans/Kurallar Matrisi — Bölüm 2 (Blacklist), 7 ERR kodu.
 * Whitelist'te match olsa bile bu kurallar öncelikle uygulanır. */
export const BLACKLIST: DenyRule[] = [
  {
    code: "ERR_001",
    source: CLIENT_KINDS,
    edge: "*",
    target: ["Table", "View"],
    message:
      "Critical Security Violation: the client layer must never access the database directly. It must go through an API or Controller.",
    suggestion:
      "Connect the Frontend to an APIGateway or Controller via REQUESTS; then build the Controller → Service → Repository → Table chain.",
  },
  {
    code: "ERR_002",
    source: "Controller",
    edge: ["QUERIES", "WRITES"],
    target: ["Table", "View"],
    message:
      "Architecture Violation: Controllers are not Data Access components. They cannot go directly to a Table. There must be a Service or Repository in between.",
    suggestion:
      "Connect the Controller to a Service via CALLS; connect the Service to a Repository via CALLS; have the Repository QUERIES/WRITES the Table.",
  },
  {
    code: "ERR_003",
    source: PASSIVE_KINDS,
    edge: "*",
    target: ACTIVE_KINDS,
    message:
      "Logic Error: data objects (Table/View/Enum/DTO) are passive. They cannot start operations, call services, or make requests.",
    suggestion:
      "Data types are always the target, never the source. Reverse the direction.",
  },
  {
    code: "ERR_004",
    source: "DTO",
    edge: ["HAS", "USES"],
    target: "Model",
    message:
      "Layer Violation: DTOs must not leak the business model (Entity). You are exposing the database schema to the client.",
    suggestion:
      "A DTO may only reference another DTO. Wrap the Model in a separate DTO or add a mapping layer.",
  },
  {
    code: "ERR_005",
    source: ["Service", "Repository"],
    edge: "REQUESTS",
    target: CLIENT_KINDS,
    message:
      "Flow Error: the server (Backend) cannot send an HTTP request to the client. Communication must use a Socket (Push) or Client Polling.",
    suggestion:
      "Use push notifications via a MessageQueue, or the client's periodic GET.",
  },
  {
    code: "ERR_006",
    source: "APIGateway",
    edge: ["CALLS", "ROUTES_TO"],
    target: ["Repository", "Table"],
    message:
      "Security Violation: the Gateway cannot route directly to a database or repository. Business logic (Service/Controller) must sit in between.",
    suggestion:
      "APIGateway → ROUTES_TO → Controller → CALLS → Service → CALLS → Repository → Table.",
  },
  {
    code: "ERR_007",
    source: "EventHandler",
    edge: "RETURNS",
    target: ["Controller", "DTO"],
    message:
      "Flow Error: asynchronous event listeners (Event Handlers) cannot return a value (Fire-and-Forget). They must PUBLISH results to another Queue.",
    suggestion:
      "Within the EventHandler, PUBLISH results to a new MessageQueue or WRITES state to the DB.",
  },
];
