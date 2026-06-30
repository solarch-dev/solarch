import type { CreatePatternInput } from "../schemas/pattern.schema";

/** Canonical architecture patterns to seed. Node properties follow the enriched
 *  v4 schemas, edges conform to EdgeKindSchema. graphJson = GraphService.apply format. */
export const CANONICAL_PATTERNS: CreatePatternInput[] = [
  {
    name: "Layered CRUD (Controller→Service→Repository→Table)",
    description: "Standard REST CRUD: the Controller receives the HTTP request, the Service runs the business logic, the Repository accesses the data, and the Table holds the data. The most common layered backend architecture.",
    tags: ["crud", "layered", "rest", "backend"],
    graph: {
      nodes: [
        { tempId: "t_ctrl", type: "Controller", properties: { ControllerName: "ResourceController", Description: "Kaynak REST API", BaseRoute: "/api/v1/resources", Endpoints: [{ HttpMethod: "POST", Route: "/", RequestDTORef: "CreateResourceDTO", ResponseDTORef: "ResourceDTO", RequiresAuth: true }] } },
        { tempId: "t_svc", type: "Service", properties: { ServiceName: "ResourceService", Description: "Resource business logic", IsTransactionScoped: true, Methods: [{ MethodName: "create", Parameters: [{ Name: "dto", Type: "CreateResourceDTO", DtoRef: "CreateResourceDTO" }], ReturnType: "ResourceDTO", ReturnDtoRef: "ResourceDTO", IsAsync: true }], Dependencies: [{ Kind: "Repository", Ref: "ResourceRepository" }] } },
        { tempId: "t_repo", type: "Repository", properties: { RepositoryName: "ResourceRepository", Description: "Resource data access", EntityReference: "resources", IsCached: false, CustomQueries: [] } },
        { tempId: "t_tbl", type: "Table", properties: { TableName: "resources", Description: "Kaynak tablosu", Columns: [{ Name: "id", DataType: "UUID", IsPrimaryKey: true, IsNotNull: true, IsUnique: true, AutoIncrement: false }] } },
        { tempId: "t_dto", type: "DTO", properties: { Name: "CreateResourceDTO", Description: "Resource creation request", Fields: [{ Name: "name", DataType: "string", IsRequired: true, IsArray: false, ValidationRules: [{ Rule: "MinLength", Value: "1" }] }] } },
      ],
      edges: [
        { sourceTempId: "t_ctrl", targetTempId: "t_svc", edgeType: "CALLS" },
        { sourceTempId: "t_svc", targetTempId: "t_repo", edgeType: "CALLS" },
        { sourceTempId: "t_repo", targetTempId: "t_tbl", edgeType: "WRITES" },
        { sourceTempId: "t_ctrl", targetTempId: "t_dto", edgeType: "USES" },
      ],
    },
  },
  {
    name: "Cache-aside (Service→Cache + Service→Repository)",
    description: "Cache-aside to reduce read load: the Service checks the Cache first, and if absent reads from the Repository and writes to the Cache. Redis with TTL, LRU eviction.",
    tags: ["cache", "performance", "read-heavy", "redis"],
    graph: {
      nodes: [
        { tempId: "t_svc", type: "Service", properties: { ServiceName: "ProfileService", Description: "Profil okuma", IsTransactionScoped: false, Methods: [{ MethodName: "getProfile", Parameters: [{ Name: "id", Type: "UUID" }], ReturnType: "ProfileDTO", IsAsync: true }], Dependencies: [{ Kind: "Cache", Ref: "ProfileCache" }, { Kind: "Repository", Ref: "ProfileRepository" }] } },
        { tempId: "t_cache", type: "Cache", properties: { CacheName: "ProfileCache", Description: "Profil cache", KeyPattern: "profile:{id}", TTL_Seconds: 3600, Engine: "Redis", EvictionPolicy: "LRU" } },
        { tempId: "t_repo", type: "Repository", properties: { RepositoryName: "ProfileRepository", Description: "Profile data access", EntityReference: "profiles", IsCached: true, CustomQueries: [] } },
      ],
      edges: [
        { sourceTempId: "t_svc", targetTempId: "t_cache", edgeType: "CACHES_IN" },
        { sourceTempId: "t_svc", targetTempId: "t_repo", edgeType: "CALLS" },
      ],
    },
  },
  {
    name: "JWT authentication flow (Auth)",
    description: "JWT-based login: the AuthController receives the login request, the AuthService authenticates and issues a token, JWT_SECRET is read from the env, and the AuthMiddleware guards protected routes.",
    tags: ["auth", "jwt", "security", "login"],
    graph: {
      nodes: [
        { tempId: "t_ctrl", type: "Controller", properties: { ControllerName: "AuthController", Description: "Authentication API", BaseRoute: "/api/v1/auth", Endpoints: [{ HttpMethod: "POST", Route: "/login", RequestDTORef: "LoginDTO", ResponseDTORef: "TokenDTO", RequiresAuth: false }] } },
        { tempId: "t_svc", type: "Service", properties: { ServiceName: "AuthService", Description: "Token generation + validation", IsTransactionScoped: false, Methods: [{ MethodName: "login", Parameters: [{ Name: "dto", Type: "LoginDTO", DtoRef: "LoginDTO" }], ReturnType: "TokenDTO", ReturnDtoRef: "TokenDTO", IsAsync: true, Throws: ["UnauthorizedException"] }], Dependencies: [{ Kind: "Repository", Ref: "UserRepository" }] } },
        { tempId: "t_mw", type: "Middleware", properties: { MiddlewareName: "AuthMiddleware", Description: "JWT validation middleware", AppliesTo: "SpecificRoutes", ExecutionOrder: 1, MiddlewareType: "Auth" } },
        { tempId: "t_env", type: "EnvironmentVariable", properties: { Key: "JWT_SECRET", Description: "JWT signing key", DataType: "String", IsSecret: true, Environment: ["Dev", "Staging", "Prod"], IsRequired: true } },
        { tempId: "t_dto", type: "DTO", properties: { Name: "LoginDTO", Description: "Login request", Fields: [{ Name: "email", DataType: "string", IsRequired: true, IsArray: false, ValidationRules: [{ Rule: "Email" }] }, { Name: "password", DataType: "string", IsRequired: true, IsArray: false, ValidationRules: [{ Rule: "MinLength", Value: "8" }] }] } },
      ],
      edges: [
        { sourceTempId: "t_ctrl", targetTempId: "t_svc", edgeType: "CALLS" },
        { sourceTempId: "t_ctrl", targetTempId: "t_dto", edgeType: "USES" },
        { sourceTempId: "t_svc", targetTempId: "t_env", edgeType: "READS_CONFIG" },
      ],
    },
  },
  {
    name: "Saga payment orchestration (distributed transaction)",
    description: "A Saga that coordinates a distributed transaction: the Orchestrator runs the steps stock reservation → payment → shipment in order; on failure it rolls back with compensation actions.",
    tags: ["saga", "orchestration", "distributed-transaction", "payment"],
    graph: {
      nodes: [
        { tempId: "t_orch", type: "Orchestrator", properties: { OrchestratorName: "OrderSaga", Description: "Order Saga coordination", Pattern: "Saga", Steps: [{ StepName: "reserveStock", ServiceRef: "InventoryService", Action: "reserve", CompensationAction: "release", OnFailure: "compensate" }, { StepName: "charge", ServiceRef: "PaymentService", Action: "charge", CompensationAction: "refund", OnFailure: "compensate" }] } },
        { tempId: "t_inv", type: "Service", properties: { ServiceName: "InventoryService", Description: "Inventory management", IsTransactionScoped: true, Methods: [{ MethodName: "reserve", ReturnType: "void", IsAsync: true }] } },
        { tempId: "t_pay", type: "Service", properties: { ServiceName: "PaymentService", Description: "Payment processing", IsTransactionScoped: true, Methods: [{ MethodName: "charge", ReturnType: "void", IsAsync: true }] } },
      ],
      edges: [
        { sourceTempId: "t_orch", targetTempId: "t_inv", edgeType: "CALLS" },
        { sourceTempId: "t_orch", targetTempId: "t_pay", edgeType: "CALLS" },
      ],
    },
  },
  {
    name: "CQRS — command/query separation",
    description: "Separates the write and read paths: the CommandService applies writes to the Table, the QueryService returns reads from a materialized View. For read scaling.",
    tags: ["cqrs", "read-model", "scalability"],
    graph: {
      nodes: [
        { tempId: "t_cmd_ctrl", type: "Controller", properties: { ControllerName: "OrderCommandController", Description: "Order write API", BaseRoute: "/api/v1/orders", Endpoints: [{ HttpMethod: "POST", Route: "/", RequestDTORef: "CreateOrderDTO", RequiresAuth: true }] } },
        { tempId: "t_cmd_svc", type: "Service", properties: { ServiceName: "OrderCommandService", Description: "Order write logic", IsTransactionScoped: true, Methods: [{ MethodName: "create", ReturnType: "void", IsAsync: true }], Dependencies: [{ Kind: "Repository", Ref: "OrderRepository" }] } },
        { tempId: "t_repo", type: "Repository", properties: { RepositoryName: "OrderRepository", Description: "Order write repository", EntityReference: "orders", IsCached: false, CustomQueries: [] } },
        { tempId: "t_tbl", type: "Table", properties: { TableName: "orders", Description: "Orders table", Columns: [{ Name: "id", DataType: "UUID", IsPrimaryKey: true, IsNotNull: true, IsUnique: true, AutoIncrement: false }] } },
        { tempId: "t_qry_svc", type: "Service", properties: { ServiceName: "OrderQueryService", Description: "Order read logic", IsTransactionScoped: false, Methods: [{ MethodName: "listSummaries", ReturnType: "OrderSummaryDTO[]", IsAsync: true }] } },
        { tempId: "t_view", type: "View", properties: { ViewName: "order_summary_view", Description: "Order summary read model", Definition: "SELECT id, total, status FROM orders", SourceTables: ["orders"], Materialized: true, RefreshStrategy: "onChange" } },
      ],
      edges: [
        { sourceTempId: "t_cmd_ctrl", targetTempId: "t_cmd_svc", edgeType: "CALLS" },
        { sourceTempId: "t_cmd_svc", targetTempId: "t_repo", edgeType: "CALLS" },
        { sourceTempId: "t_repo", targetTempId: "t_tbl", edgeType: "WRITES" },
        { sourceTempId: "t_qry_svc", targetTempId: "t_view", edgeType: "QUERIES" },
      ],
    },
  },
  {
    name: "Event-driven (publish/subscribe)",
    description: "Loosely coupled asynchronous processing: a Service publishes an event to a MessageQueue, and an EventHandler subscribes and processes it. Removes the synchronous dependency.",
    tags: ["event-driven", "async", "pubsub", "messaging"],
    graph: {
      nodes: [
        { tempId: "t_svc", type: "Service", properties: { ServiceName: "OrderService", Description: "Order creation", IsTransactionScoped: true, Methods: [{ MethodName: "place", ReturnType: "void", IsAsync: true }] } },
        { tempId: "t_mq", type: "MessageQueue", properties: { QueueName: "order-events", Description: "Order events", Type: "Topic", Provider: "Kafka", MessageFormat: "OrderEventDTO", DeliveryGuarantee: "at-least-once", DeadLetterQueue: "order-events-dlq" } },
        { tempId: "t_handler", type: "EventHandler", properties: { HandlerName: "OrderPlacedHandler", Description: "Post-order notification", EventName: "ORDER_PLACED", IsAsync: true, QueueRef: "order-events", RetryPolicy: { MaxRetries: 5, DelaySeconds: 30 }, DeadLetterQueue: "order-events-dlq" } },
      ],
      edges: [
        { sourceTempId: "t_svc", targetTempId: "t_mq", edgeType: "PUBLISHES" },
        { sourceTempId: "t_handler", targetTempId: "t_mq", edgeType: "SUBSCRIBES" },
      ],
    },
  },
  {
    name: "API Gateway routing",
    description: "Single entry point: the APIGateway routes incoming requests to the appropriate Controllers; auth, rate limit and CORS are applied at the gateway level.",
    tags: ["api-gateway", "routing", "edge", "bff"],
    graph: {
      nodes: [
        { tempId: "t_gw", type: "APIGateway", properties: { GatewayName: "MainGateway", Description: "Main entry gateway", Provider: "Kong", AuthMode: "JWT", CorsEnabled: true, Routes: [{ Path: "/users", TargetRef: "UserController", Methods: ["GET", "POST"], AuthRequired: true, RateLimit: { Requests: 100, WindowSeconds: 60 } }] } },
        { tempId: "t_ctrl", type: "Controller", properties: { ControllerName: "UserController", Description: "User API", BaseRoute: "/users", Endpoints: [{ HttpMethod: "GET", Route: "/", RequiresAuth: true }] } },
      ],
      edges: [
        { sourceTempId: "t_gw", targetTempId: "t_ctrl", edgeType: "ROUTES_TO" },
      ],
    },
  },
  {
    name: "Repository + custom query",
    description: "Data access abstraction: the Repository manages a Table and, beyond standard CRUD, defines named custom queries (findByEmail, etc.).",
    tags: ["repository", "dao", "query", "data-access"],
    graph: {
      nodes: [
        { tempId: "t_repo", type: "Repository", properties: { RepositoryName: "UserRepository", Description: "User data access", EntityReference: "users", IsCached: false, CustomQueries: [{ QueryName: "findByEmail", QueryType: "findOne", Parameters: [{ Name: "email", Type: "string" }], ReturnType: "User" }, { QueryName: "findActive", QueryType: "find", Parameters: [], ReturnType: "User[]" }] } },
        { tempId: "t_tbl", type: "Table", properties: { TableName: "users", Description: "Users", Columns: [{ Name: "id", DataType: "UUID", IsPrimaryKey: true, IsNotNull: true, IsUnique: true, AutoIncrement: false }, { Name: "email", DataType: "VARCHAR", Length: 255, IsPrimaryKey: false, IsNotNull: true, IsUnique: true, AutoIncrement: false }], Indexes: [{ IndexName: "idx_email", Columns: ["email"], Type: "BTree", IsUnique: true }] } },
      ],
      edges: [
        { sourceTempId: "t_repo", targetTempId: "t_tbl", edgeType: "QUERIES" },
      ],
    },
  },
  {
    name: "DTO validation layer",
    description: "Input validation: the Controller endpoint uses a request DTO; the DTO fields are protected with structural validation rules (Email, MinLength, Min/Max). Clean data reaches the business layer.",
    tags: ["dto", "validation", "input", "contract"],
    graph: {
      nodes: [
        { tempId: "t_ctrl", type: "Controller", properties: { ControllerName: "SignupController", Description: "Signup API", BaseRoute: "/api/v1/signup", Endpoints: [{ HttpMethod: "POST", Route: "/", RequestDTORef: "SignupDTO", ResponseDTORef: "UserDTO", RequiresAuth: false }] } },
        { tempId: "t_req", type: "DTO", properties: { Name: "SignupDTO", Description: "Signup request", Fields: [{ Name: "email", DataType: "string", IsRequired: true, IsArray: false, ValidationRules: [{ Rule: "Email" }] }, { Name: "age", DataType: "number", IsRequired: false, IsArray: false, ValidationRules: [{ Rule: "Min", Value: "18" }] }] } },
        { tempId: "t_res", type: "DTO", properties: { Name: "UserDTO", Description: "User response", Fields: [{ Name: "id", DataType: "string", IsRequired: true, IsArray: false }] } },
      ],
      edges: [
        { sourceTempId: "t_ctrl", targetTempId: "t_req", edgeType: "USES" },
        { sourceTempId: "t_ctrl", targetTempId: "t_res", edgeType: "RETURNS" },
      ],
    },
  },
  {
    name: "Exception hierarchy",
    description: "Consistent error handling: custom exceptions derive from a base exception; the Service throws the appropriate exception on a business-rule violation, carrying an HTTP status + log severity.",
    tags: ["exception", "error-handling", "hierarchy"],
    graph: {
      nodes: [
        { tempId: "t_svc", type: "Service", properties: { ServiceName: "BillingService", Description: "Billing", IsTransactionScoped: true, Methods: [{ MethodName: "charge", ReturnType: "void", IsAsync: true, Throws: ["InsufficientFundsException"] }] } },
        { tempId: "t_base", type: "Exception", properties: { ExceptionName: "DomainException", Description: "Base business error", HttpStatusCode: 400, LogSeverity: "Warning", ErrorCode: "ERR_DOMAIN" } },
        { tempId: "t_child", type: "Exception", properties: { ExceptionName: "InsufficientFundsException", Description: "Yetersiz bakiye", HttpStatusCode: 402, LogSeverity: "Warning", ErrorCode: "ERR_INSUFFICIENT_FUNDS", ParentExceptionRef: "DomainException" } },
      ],
      edges: [
        { sourceTempId: "t_svc", targetTempId: "t_child", edgeType: "THROWS" },
        { sourceTempId: "t_child", targetTempId: "t_base", edgeType: "EXTENDS" },
      ],
    },
  },
  {
    name: "Scheduled task (Worker/cron)",
    description: "Periodic background job: the Worker runs on a cron trigger, calling a Service to perform a batch job; resilient with a retry policy + timeout.",
    tags: ["worker", "cron", "scheduled", "batch"],
    graph: {
      nodes: [
        { tempId: "t_worker", type: "Worker", properties: { WorkerName: "DailyReportWorker", Description: "Daily report generation", Schedule: "0 2 * * *", TaskToExecute: "generateDailyReport", TimeoutSeconds: 600, RetryPolicy: { MaxRetries: 3, BackoffStrategy: "exponential", DelaySeconds: 60 }, IsEnabled: true } },
        { tempId: "t_svc", type: "Service", properties: { ServiceName: "ReportService", Description: "Report generation", IsTransactionScoped: false, Methods: [{ MethodName: "generateDaily", ReturnType: "void", IsAsync: true }], Dependencies: [{ Kind: "Repository", Ref: "ReportRepository" }] } },
      ],
      edges: [
        { sourceTempId: "t_worker", targetTempId: "t_svc", edgeType: "CALLS" },
      ],
    },
  },
  {
    name: "External service integration (circuit breaker)",
    description: "Third-party API call: the Service sends REQUESTS to an ExternalService; external failures are isolated with timeout, retry and a circuit breaker.",
    tags: ["external-service", "integration", "circuit-breaker", "resilience"],
    graph: {
      nodes: [
        { tempId: "t_svc", type: "Service", properties: { ServiceName: "CheckoutService", Description: "Payment collection", IsTransactionScoped: true, Methods: [{ MethodName: "pay", ReturnType: "PaymentResultDTO", IsAsync: true, Throws: ["PaymentGatewayException"] }], Dependencies: [{ Kind: "ExternalService", Ref: "StripeAPI" }] } },
        { tempId: "t_ext", type: "ExternalService", properties: { ServiceName: "StripeAPI", Description: "Stripe payment integration", BaseURL: "https://api.stripe.com/v1", AuthType: "Bearer", TimeoutSeconds: 30, Endpoints: [{ Name: "createCharge", Method: "POST", Path: "/charges" }], RetryPolicy: { MaxRetries: 2, DelaySeconds: 2 }, CircuitBreaker: { FailureThreshold: 5, ResetSeconds: 30 } } },
      ],
      edges: [
        { sourceTempId: "t_svc", targetTempId: "t_ext", edgeType: "REQUESTS" },
      ],
    },
  },
];
