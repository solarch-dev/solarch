/** Solarch docs — node types, edge types, keyboard shortcuts. */

export interface NodeDoc {
  type: string;
  family: string;
  familyLabel: string;
  /** 1-2 paragraphs: what it is, what it does */
  summary: string;
  /** Where it's used in software — practical bullet list */
  whereUsed: string[];
  /** Real-world examples */
  examples: string[];
  /** Typical connection patterns (who → whom, with which edge) */
  commonEdges: string[];
}

export const NODE_DOCS: NodeDoc[] = [
  {
    type: "Table",
    family: "data",
    familyLabel: "Data",
    summary:
      "Relational database table. Models the schema (columns, primary key, foreign key, index, constraint). The most fundamental unit where data is persisted; read/written by Repository.",
    whereUsed: [
      "PostgreSQL, MySQL, SQL Server DDL generation",
      "TypeORM / Prisma / SQLAlchemy entity definitions",
      "Migration scripts (CREATE TABLE, ALTER TABLE)",
      "ER diagrams, data dictionary documentation",
    ],
    examples: [
      "users — id (PK), email (UNIQUE), passwordHash, createdAt",
      "orders — id (PK), userId (FK→users), status (ENUM), total (DECIMAL)",
      "products — id (PK), sku (UNIQUE), name, priceCents (INT)",
    ],
    commonEdges: [
      "Repository → QUERIES → Table (read)",
      "Repository → WRITES → Table (write)",
      "Table ← USES ← Model (ORM mapping)",
    ],
  },
  {
    type: "DTO",
    family: "data",
    familyLabel: "Data",
    summary:
      "Data Transfer Object — a data container carried between layers. Used as the request body or response payload for Controller endpoints. Contains validation rules.",
    whereUsed: [
      "REST endpoint request/response body (NestJS @Body, Express)",
      "GraphQL input/output types",
      "API contract — frontend ↔ backend types",
      "Validation frameworks (class-validator, Zod, Yup)",
    ],
    examples: [
      "CreateUserDto — email, password (MinLength 8), confirmPassword",
      "OrderResponseDto — id, status, total, items[]",
      "LoginRequest — username, password",
    ],
    commonEdges: [
      "Controller → USES → DTO (endpoint payload)",
      "Service → RETURNS → DTO (response)",
      "DTO → USES → Enum (enum field)",
    ],
  },
  {
    type: "Model",
    family: "data",
    familyLabel: "Data",
    summary:
      "Domain Model / Entity — an ORM-mapped class used in business logic. Typically corresponds to a Table but can contain behavior (methods); unlike a DTO, it holds business invariants.",
    whereUsed: [
      "TypeORM @Entity, Prisma Model, Hibernate @Entity",
      "Domain-Driven Design (DDD) entities",
      "Active Record / Rich Domain Model pattern",
    ],
    examples: [
      "User { id, email, hashedPassword; validatePassword(plain) }",
      "Order { id, items, status; canCancel(): boolean }",
      "Product { id, sku, price; applyDiscount(pct) }",
    ],
    commonEdges: [
      "Model → USES → Table (mapping)",
      "Service → USES → Model (business logic)",
      "Model → USES → Model (relations: OneToMany, ManyToOne)",
    ],
  },
  {
    type: "Enum",
    family: "data",
    familyLabel: "Data",
    summary:
      "A fixed set of values. Used for type-safe category or status definitions. Backing type can be string or int.",
    whereUsed: [
      "TypeScript enum, Java/Kotlin enum class, C# enum",
      "PostgreSQL ENUM type",
      "Status machine — order/payment status",
      "Role-based access — user roles",
    ],
    examples: [
      "OrderStatus — PENDING, PAID, SHIPPED, DELIVERED, CANCELLED",
      "UserRole — admin, customer, support",
      "PaymentMethod — credit_card, wallet, bank_transfer",
    ],
    commonEdges: [
      "Table → USES → Enum (column type)",
      "DTO → USES → Enum (field)",
      "Model → USES → Enum (property)",
    ],
  },
  {
    type: "View",
    family: "data",
    familyLabel: "Data",
    summary:
      "Database view — a virtual query result defined over one or more tables. Can be materialized (physical) or virtual.",
    whereUsed: [
      "PostgreSQL CREATE VIEW / MATERIALIZED VIEW",
      "Reporting / analytics layer",
      "Reducing complex JOINs into a single query",
      "Permission-based data presentation (column subsets)",
    ],
    examples: [
      "active_users_view — non-soft-deleted users",
      "monthly_revenue_view — orders + payments aggregate",
      "user_orders_summary — user × order(count, total) join",
    ],
    commonEdges: [
      "View → QUERIES → Table (source tables)",
      "Repository → QUERIES → View (read access)",
    ],
  },
  {
    type: "Service",
    family: "business",
    familyLabel: "Business Logic",
    summary:
      "Domain/Application Service — the layer that coordinates business rules. Takes the request from the Controller, fetches data via Repository, applies business logic, and returns the result. The core of a single bounded context.",
    whereUsed: [
      "NestJS @Injectable Services",
      "Spring @Service",
      ".NET MediatR handlers",
      "DDD Application Service / Use Case",
    ],
    examples: [
      "AuthService — register, login, refreshToken, validatePassword",
      "OrderService — createOrder, cancelOrder, calculateTotal",
      "NotificationService — sendEmail, sendSMS, scheduleNotification",
    ],
    commonEdges: [
      "Controller → CALLS → Service",
      "Service → CALLS → Repository",
      "Service → CALLS → Service (cross-context)",
      "Service → PUBLISHES → MessageQueue (event emit)",
    ],
  },
  {
    type: "Worker",
    family: "business",
    familyLabel: "Business Logic",
    summary:
      "Background worker — runs long-running or periodic tasks in the background. Listens to a queue or is triggered by cron. Operates independently from the UI thread.",
    whereUsed: [
      "BullMQ / Celery / Sidekiq workers",
      "Email sending, report generation, video transcoding",
      "Data import/export jobs",
      "Cron-scheduled cleanup (cache, soft-delete) jobs",
    ],
    examples: [
      "EmailWorker — sends queued emails in order",
      "ReportWorker — generates monthly report at 02:00 AM",
      "ThumbnailWorker — creates thumbnail for uploaded images",
    ],
    commonEdges: [
      "Worker → SUBSCRIBES → MessageQueue (job consumption)",
      "Worker → CALLS → Service (business logic)",
      "Worker → READS_CONFIG → EnvironmentVariable",
    ],
  },
  {
    type: "EventHandler",
    family: "business",
    familyLabel: "Business Logic",
    summary:
      "A handler that receives events in an event-driven architecture. Processes messages from Pub/Sub or event bus. Focuses on a single event type (Single Responsibility).",
    whereUsed: [
      "NestJS CQRS @EventsHandler",
      "Event Sourcing projections",
      "Kafka consumers",
      "Domain event handlers (UserRegistered → SendWelcomeEmail)",
    ],
    examples: [
      "UserRegisteredHandler — sends welcome email",
      "OrderPaidHandler — decrements stock, creates shipping order",
      "PaymentFailedHandler — notifies the user",
    ],
    commonEdges: [
      "EventHandler → SUBSCRIBES → MessageQueue",
      "EventHandler → CALLS → Service",
      "MessageQueue → ROUTES_TO → EventHandler",
    ],
  },
  {
    type: "Orchestrator",
    family: "business",
    familyLabel: "Business Logic",
    summary:
      "Saga / process manager — a long-lived workflow that coordinates multiple services. Executes distributed transaction steps in sequence, runs compensation on failure.",
    whereUsed: [
      "Saga pattern (e-commerce checkout flow)",
      "Temporal, Camunda, AWS Step Functions",
      "Distributed transaction — reservation + payment + shipping",
      "Long-running approval workflows",
    ],
    examples: [
      "CheckoutSaga — reserve stock → payment → shipping (each step compensable)",
      "OnboardingFlow — registration → email verification → profile completion",
      "RefundOrchestrator — refund approval → payment reversal → notification",
    ],
    commonEdges: [
      "Orchestrator → CALLS → Service (each step)",
      "Orchestrator → PUBLISHES → MessageQueue (compensation tetik)",
    ],
  },
  {
    type: "Controller",
    family: "access",
    familyLabel: "Access",
    summary:
      "The layer that manages HTTP endpoints. Parses the request, validates it, calls the Service, and serializes the response. Never accesses the database directly — works through the Service layer.",
    whereUsed: [
      "NestJS @Controller, Express Router, Spring @RestController",
      "REST API endpoint groups (UserController, OrderController)",
      "API versioning (v1, v2)",
      "OpenAPI/Swagger doc generation",
    ],
    examples: [
      "UserController — GET /users, POST /users, PATCH /users/:id",
      "AuthController — POST /auth/login, POST /auth/refresh",
      "OrderController — POST /orders, GET /orders/:id/status",
    ],
    commonEdges: [
      "FrontendApp → REQUESTS → Controller",
      "Controller → CALLS → Service",
      "Controller → USES → DTO (request/response)",
      "Middleware → ROUTES_TO → Controller",
    ],
  },
  {
    type: "APIGateway",
    family: "access",
    familyLabel: "Access",
    summary:
      "API Gateway — the single entry point for all client requests. Handles routing, rate limiting, auth, request aggregation, and response transformation. The front face of a microservice architecture.",
    whereUsed: [
      "Kong, Envoy, AWS API Gateway, Apigee",
      "Backend-for-Frontend (BFF) pattern",
      "Service mesh edge (Istio ingress)",
      "Public API layer (rate limit, API key auth)",
    ],
    examples: [
      "PublicAPIGateway — /api/v1/* → routing to internal services",
      "MobileBFF — optimized aggregator for mobile app",
      "AdminGateway — separate auth + rate limit for admin panel",
    ],
    commonEdges: [
      "FrontendApp → REQUESTS → APIGateway",
      "APIGateway → ROUTES_TO → Controller (downstream)",
      "APIGateway → READS_CONFIG → EnvironmentVariable",
    ],
  },
  {
    type: "MessageQueue",
    family: "access",
    familyLabel: "Access",
    summary:
      "Async message queue — producers push messages, consumers process them. Provides decoupling (sender doesn't wait for a reply), smooths peak load, and includes retry/dead-letter logic.",
    whereUsed: [
      "RabbitMQ, AWS SQS, Apache Kafka, Redis Pub/Sub",
      "Event-driven architecture (domain events)",
      "Job/task queue (BullMQ, Celery)",
      "Async communication between microservices",
    ],
    examples: [
      "user.registered — new signup event, triggers mail + analytics",
      "order.paid — payment completed, processes stock + shipping + invoice",
      "email.send — outgoing emails are queued for delivery",
    ],
    commonEdges: [
      "Service → PUBLISHES → MessageQueue",
      "Worker → SUBSCRIBES → MessageQueue",
      "EventHandler → SUBSCRIBES → MessageQueue",
    ],
  },
  {
    type: "Repository",
    family: "infrastructure",
    familyLabel: "Infrastructure",
    summary:
      "Persistence layer — the adapter between Service and the database. Isolates the domain from database details. Provides type-safe queries and abstracts transaction management.",
    whereUsed: [
      "TypeORM Repository, Prisma Client, Spring Data JpaRepository",
      "Repository pattern (DDD)",
      "Query builder layer (Knex, Drizzle)",
      "Unit of Work pattern",
    ],
    examples: [
      "UserRepository — findByEmail, save, softDelete",
      "OrderRepository — findWithItems, updateStatus",
      "AuditLogRepository — append-only inserts",
    ],
    commonEdges: [
      "Service → CALLS → Repository",
      "Repository → QUERIES → Table",
      "Repository → WRITES → Table",
    ],
  },
  {
    type: "Cache",
    family: "infrastructure",
    familyLabel: "Infrastructure",
    summary:
      "In-memory or distributed cache layer. Keeps frequently read data in RAM — reduces DB load and lowers latency. Requires TTL and invalidation strategy.",
    whereUsed: [
      "Redis, Memcached, Hazelcast",
      "Session storage (NextAuth, express-session)",
      "Rate limiting counters",
      "Response cache for read-heavy endpoints",
    ],
    examples: [
      "user:{id} — user profile cached for 10 minutes",
      "rate-limit:{ip} — per-IP request counter (1min TTL)",
      "product-list:popular — homepage product list (5min)",
    ],
    commonEdges: [
      "Service → CACHES_IN → Cache",
      "Cache → READS_CONFIG → EnvironmentVariable (TTL, host)",
    ],
  },
  {
    type: "ExternalService",
    family: "infrastructure",
    familyLabel: "Infrastructure",
    summary:
      "A third-party service outside the system. Examples include Stripe, SendGrid, Google Maps, OpenAI API. Requires network calls, retry/timeout policies, and credential management.",
    whereUsed: [
      "Payment systems (Stripe, iyzico)",
      "Email/SMS gateway (SendGrid, Twilio)",
      "Auth providers (Auth0, Okta)",
      "Third-party AI APIs (OpenAI, Anthropic)",
    ],
    examples: [
      "StripeAPI — payment intent, refund, webhook",
      "SendGridAPI — transactional mail",
      "AnthropicAPI — LLM completions",
    ],
    commonEdges: [
      "Service → REQUESTS → ExternalService",
      "ExternalService → READS_CONFIG → EnvironmentVariable (API key)",
    ],
  },
  {
    type: "FrontendApp",
    family: "client",
    familyLabel: "Client",
    summary:
      "Client application — SPA, mobile app, dashboard. Sends REQUESTS to the backend, renders the user interface. Composed of UIComponents.",
    whereUsed: [
      "React/Next.js SPA",
      "Vue/Nuxt, Angular",
      "React Native, Flutter mobil",
      "Admin dashboard, customer portal",
    ],
    examples: [
      "WebApp — customer portal (Next.js)",
      "AdminPanel — admin dashboard (React + Vite)",
      "MobileApp — iOS/Android (React Native)",
    ],
    commonEdges: [
      "FrontendApp → REQUESTS → APIGateway / Controller",
      "FrontendApp → HAS → UIComponent",
    ],
  },
  {
    type: "UIComponent",
    family: "client",
    familyLabel: "Client",
    summary:
      "Reusable UI piece — button, form, card, modal. The atomic unit of a design system. Typically receives props and emits callbacks.",
    whereUsed: [
      "React components (Button, Card, Modal)",
      "Vue/Svelte components",
      "Design system (shadcn/ui, MUI, Ant Design)",
      "Units documented in Storybook",
    ],
    examples: [
      "LoginForm — email + password + submit",
      "ProductCard — image + title + price + add-to-cart",
      "DataTable — sortable, filterable table",
    ],
    commonEdges: [
      "FrontendApp → HAS → UIComponent",
      "UIComponent → USES → DTO (props type)",
    ],
  },
  {
    type: "Middleware",
    family: "security",
    familyLabel: "Security",
    summary:
      "An intermediary layer in the request/response pipeline. Applies cross-cutting concerns like auth, logging, CORS, rate limiting, and error handling. Triggered before reaching or after leaving the Controller.",
    whereUsed: [
      "Express middleware, NestJS @UseGuards / @UseInterceptors",
      "ASP.NET middleware pipeline",
      "JWT token validation",
      "Request logging, rate limit, CORS, compression",
    ],
    examples: [
      "JwtAuthMiddleware — validates Authorization header",
      "RateLimitMiddleware — 100 req/min per IP",
      "ErrorHandlerMiddleware — global exception → JSON response",
    ],
    commonEdges: [
      "Middleware → ROUTES_TO → Controller",
      "Middleware → READS_CONFIG → EnvironmentVariable (JWT secret)",
      "Middleware → THROWS → Exception",
    ],
  },
  {
    type: "EnvironmentVariable",
    family: "configuration",
    familyLabel: "Configuration",
    summary:
      "Runtime configuration variable. Secrets, connection strings, feature flags. Never hardcoded in source — follows the 12-factor app principle.",
    whereUsed: [
      ".env files (dotenv)",
      "AWS Secrets Manager, HashiCorp Vault",
      "Kubernetes ConfigMap / Secret",
      "Feature flag services (LaunchDarkly)",
    ],
    examples: [
      "DATABASE_URL — Postgres connection string",
      "JWT_SECRET — token signing key",
      "ANTHROPIC_API_KEY — LLM credential",
    ],
    commonEdges: [
      "Service → READS_CONFIG → EnvironmentVariable",
      "Middleware → READS_CONFIG → EnvironmentVariable",
    ],
  },
  {
    type: "Exception",
    family: "configuration",
    familyLabel: "Configuration",
    summary:
      "A domain or technical error class. Specific exception types (NotFound, Unauthorized, ValidationError) carry semantic meaning instead of a generic Error. Maps to an HTTP status code.",
    whereUsed: [
      "NestJS HttpException, custom exception filters",
      "Domain exception (InsufficientStockError)",
      "Error boundaries (React)",
      "Global exception handler",
    ],
    examples: [
      "UserNotFoundException — 404",
      "InvalidCredentialsException — 401",
      "InsufficientStockException — 409 (business rule)",
    ],
    commonEdges: [
      "Service → THROWS → Exception",
      "Controller → THROWS → Exception",
      "Middleware → THROWS → Exception",
    ],
  },
  {
    type: "Module",
    family: "structure",
    familyLabel: "Structure",
    summary:
      "An organizational unit that groups related components. Defines a bounded context, feature folder, or dependency injection scope. Contains a single domain concern.",
    whereUsed: [
      "NestJS @Module",
      "Angular NgModule",
      "Go package, Python package",
      "Feature module (auth, billing, orders)",
    ],
    examples: [
      "AuthModule — UserController, AuthService, JwtStrategy",
      "BillingModule — InvoiceService, PaymentRepository",
      "OrdersModule — Order, OrderItem, OrderService",
    ],
    commonEdges: [
      "Module → DEPENDS_ON → Module (cross-module)",
    ],
  },
];

// ─── EDGE DOCS ────────────────────────────────────────────────────

export interface EdgeDoc {
  kind: string;
  category: string;
  summary: string;
  whenToUse: string[];
  examples: string[];
}

export const EDGE_DOCS: EdgeDoc[] = [
  {
    kind: "CALLS",
    category: "Calls & Communication",
    summary:
      "Synchronous in-process method/function call. Component A calls component B's method within the same application and waits for the return value. Typical backend control flow.",
    whenToUse: [
      "Controller → Service",
      "Service → Repository",
      "Service → Service (same bounded context)",
    ],
    examples: [
      "AuthController.login() → AuthService.validateCredentials()",
      "OrderService.create() → OrderRepository.save()",
    ],
  },
  {
    kind: "REQUESTS",
    category: "Calls & Communication",
    summary:
      "HTTP/gRPC request over the network. Crosses the network boundary — client → backend, microservice → microservice, backend → external API. Requires latency and fault tolerance handling.",
    whenToUse: [
      "FrontendApp → Controller",
      "Service → ExternalService (Stripe, SendGrid)",
      "Microservice A → Microservice B",
    ],
    examples: [
      "WebApp → POST /auth/login",
      "OrderService → POST https://api.stripe.com/v1/charges",
    ],
  },
  {
    kind: "PUBLISHES",
    category: "Async",
    summary:
      "A producer publishes an event/message (fire-and-forget). Doesn't wait for a reply; listeners process it asynchronously. Provides loose coupling.",
    whenToUse: [
      "Emitting domain events (UserRegistered, OrderPaid)",
      "Background job enqueue",
      "Event sourcing — write state changes as events",
    ],
    examples: [
      "AuthService → PUBLISHES → user.registered (topic)",
      "OrderService → PUBLISHES → order.paid",
    ],
  },
  {
    kind: "SUBSCRIBES",
    category: "Async",
    summary:
      "A consumer subscribes to a topic/queue and processes incoming messages. Used by Workers or EventHandlers.",
    whenToUse: [
      "Background worker queue listening",
      "Domain event handler",
      "CQRS read-model projection",
    ],
    examples: [
      "EmailWorker → SUBSCRIBES → user.registered → welcome email",
      "AnalyticsHandler → SUBSCRIBES → order.paid",
    ],
  },
  {
    kind: "USES",
    category: "Data & Schema",
    summary:
      "Generic usage/reference relationship. One component depends on another's schema or type. Composition, but data-based rather than behavioral.",
    whenToUse: [
      "DTO as request body in a Controller endpoint",
      "DTO field referencing an Enum",
      "Model mapping to a Table",
    ],
    examples: [
      "UserController → USES → CreateUserDto",
      "OrderDto → USES → OrderStatusEnum",
    ],
  },
  {
    kind: "HAS",
    category: "Data & Schema",
    summary:
      "Composition relationship — parent contains the child (ownership). UML aggregation/composition. Whole-part semantics.",
    whenToUse: [
      "FrontendApp contains UIComponents",
      "Model nested object field",
    ],
    examples: [
      "WebApp → HAS → LoginForm",
      "Order → HAS → OrderItem[]",
    ],
  },
  {
    kind: "EXTENDS",
    category: "Data & Schema",
    summary:
      "Inheritance / extension — one class inherits from another. OO `extends` or interface extension. The basis for polymorphism.",
    whenToUse: [
      "BaseEntity → User, Order (timestamp + id)",
      "Abstract Service",
    ],
    examples: [
      "AdminUser → EXTENDS → User",
      "TenantAwareEntity → EXTENDS → BaseEntity",
    ],
  },
  {
    kind: "IMPLEMENTS",
    category: "Data & Schema",
    summary:
      "Interface implementation — a class fulfills a contract. The basis for strategy pattern and dependency inversion.",
    whenToUse: [
      "Strategy pattern (PaymentStrategy interface)",
      "Repository interface + concrete impl",
    ],
    examples: [
      "StripePaymentProcessor → IMPLEMENTS → IPaymentProcessor",
      "PostgresUserRepository → IMPLEMENTS → IUserRepository",
    ],
  },
  {
    kind: "RETURNS",
    category: "Data & Schema",
    summary:
      "Return type of a method or endpoint. The response shape contract.",
    whenToUse: [
      "Controller endpoint response DTO",
      "Service method return type",
    ],
    examples: [
      "AuthController.login() → RETURNS → LoginResponseDto",
      "OrderService.find(id) → RETURNS → Order",
    ],
  },
  {
    kind: "QUERIES",
    category: "DB I/O",
    summary:
      "Read-only database query — SELECT. Cardinality is shown with crow's foot notation (usually many).",
    whenToUse: [
      "Repository.find / findMany",
      "Reading from View source tables",
    ],
    examples: [
      "UserRepository → QUERIES → users (findByEmail)",
      "ActiveUsersView → QUERIES → users",
    ],
  },
  {
    kind: "WRITES",
    category: "DB I/O",
    summary:
      "Write database operation — INSERT / UPDATE / DELETE. Participates in a transaction.",
    whenToUse: [
      "Repository.save / update / delete",
      "Migration scripts",
    ],
    examples: [
      "OrderRepository → WRITES → orders (save)",
      "AuditLogRepository → WRITES → audit_logs (append)",
    ],
  },
  {
    kind: "CACHES_IN",
    category: "Infrastructure",
    summary:
      "The relationship where a Service caches results or reads from cache. Carries TTL and invalidation strategy.",
    whenToUse: [
      "Read-heavy endpoint response cache",
      "Session / token cache",
      "Rate limit counter",
    ],
    examples: [
      "UserService → CACHES_IN → Redis (user:{id})",
      "ProductService → CACHES_IN → Redis (popular-products)",
    ],
  },
  {
    kind: "DEPENDS_ON",
    category: "Architecture",
    summary:
      "Generic dependency relationship — especially at the Module level. Expresses build/import order or runtime dependency.",
    whenToUse: [
      "Module-to-Module dependency",
      "Cross-package imports",
    ],
    examples: [
      "OrdersModule → DEPENDS_ON → AuthModule",
      "BillingModule → DEPENDS_ON → OrdersModule",
    ],
  },
  {
    kind: "READS_CONFIG",
    category: "Architecture",
    summary:
      "The relationship where a component reads an EnvironmentVariable. Access to secrets or feature flags.",
    whenToUse: [
      "Service startup — loading config",
      "Runtime feature toggle",
      "External service credential",
    ],
    examples: [
      "AuthService → READS_CONFIG → JWT_SECRET",
      "StripeClient → READS_CONFIG → STRIPE_API_KEY",
    ],
  },
  {
    kind: "THROWS",
    category: "Architecture",
    summary:
      "Indicates the exception type a component can throw. The error contract (checked exception).",
    whenToUse: [
      "Service throws domain exception on business rule violation",
      "Controller validation error",
    ],
    examples: [
      "AuthService → THROWS → InvalidCredentialsException",
      "OrderService → THROWS → InsufficientStockException",
    ],
  },
  {
    kind: "ROUTES_TO",
    category: "Architecture",
    summary:
      "The relationship where an API Gateway or Middleware routes traffic to a downstream component.",
    whenToUse: [
      "APIGateway → Controller routing",
      "Middleware → Controller (auth/logging pipeline)",
    ],
    examples: [
      "PublicAPIGateway → ROUTES_TO → UserController",
      "JwtAuthMiddleware → ROUTES_TO → ProtectedController",
    ],
  },
];

// ─── KEYBOARD SHORTCUTS ───────────────────────────────────────────

export interface ShortcutDoc {
  group: string;
  keys: string;
  description: string;
}

export const SHORTCUT_DOCS: ShortcutDoc[] = [
  // General
  { group: "General", keys: "⌘K", description: "Command palette — actions, search nodes, switch tabs" },
  { group: "General", keys: "Esc", description: "Hierarchically close modal / menu / selection" },

  // Editing
  { group: "Editing", keys: "Double click", description: "Edit node (opens modal)" },
  { group: "Editing", keys: "⌘E", description: "Toggle editor modal for selected node" },
  { group: "Editing", keys: "F2", description: "Rename selected node (inline)" },
  { group: "Editing", keys: "⌘⇧C", description: "Copy selected node" },
  { group: "Editing", keys: "Del / ⌫", description: "Delete selected node or edge" },

  // Undo/Redo
  { group: "History", keys: "⌘Z", description: "Undo" },
  { group: "History", keys: "⌘⇧Z", description: "Redo" },

  // Canvas
  { group: "Canvas", keys: "Drag", description: "Drag empty area → pan" },
  { group: "Canvas", keys: "Scroll wheel", description: "Zoom in / zoom out" },
  { group: "Canvas", keys: "⌥L", description: "Auto arrange (Dagre layout)" },
  { group: "Canvas", keys: "Right click", description: "Open new node menu" },

  // Edge
  { group: "Edge", keys: "Drag from port", description: "Draw new edge (right port out, left port in)" },
  { group: "Edge", keys: "Click (on edge)", description: "Select edge (hover → click)" },
  { group: "Edge", keys: "Drag bend handle", description: "Move bend point in elbow mode" },

  // Tabs
  { group: "Tabs", keys: "+ button", description: "Create new tab" },
  { group: "Tabs", keys: "Double click (tab name)", description: "Rename tab (inline)" },
  { group: "Tabs", keys: "Hover + X", description: "Delete tab (except default)" },

  // AI
  { group: "AI", keys: "Bottom OmniBar", description: "Agent: generate architecture · Instruct: chat" },
  { group: "AI", keys: "Continue button (Instruct)", description: "Stream to next sentence" },
];
