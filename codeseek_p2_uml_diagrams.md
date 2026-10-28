# CodeSeek Phase 2 UML Diagrams

> [!NOTE]
> These UML diagrams have been updated and corrected to accurately represent the **CURRENT implementation** of CodeSeek as a local, Python-based static analysis platform. The diagrams reflect actual service boundaries, conceptual data models, and features verified against the repository (including `graphs.py`, `core.py`, `indexer.py`, FastAPI routers, and React frontend capabilities).

---

## 1. Use Case Diagram

**Purpose**: Maps out the explicit ways an end-user interacts with the CodeSeek platform, capturing all core capabilities like uploading, exploring, searching, and viewing dependencies, while organizing features cleanly to reduce crossing lines.

```plantuml
@startuml
left to right direction
skinparam packageStyle rectangle

actor User

package "CodeSeek Platform" {
  package "Core Actions" {
    usecase "Analyze Repository" as UC_Analyze
    usecase "Upload Repository ZIP" as UC_Upload
    usecase "Update/Re-index Repository" as UC_Update
  }
  
  package "Exploration" {
    usecase "View Dashboard" as UC_Dash
    usecase "Search Code" as UC_Search
    usecase "Browse Files" as UC_Files
    usecase "Explore Functions/Methods" as UC_Funcs
    usecase "Explore Classes" as UC_Classes
    usecase "Navigate to Source" as UC_Nav
  }
  
  package "Analytics" {
    usecase "View Dependency Graphs" as UC_Graph
    usecase "View Circular Dependencies" as UC_Circ
    usecase "View Statistics" as UC_Stats
  }
}

User --> UC_Analyze
User --> UC_Update
User --> UC_Dash
User --> UC_Search
User --> UC_Files
User --> UC_Funcs
User --> UC_Classes
User --> UC_Graph
User --> UC_Stats

UC_Analyze ..> UC_Upload : <<include>>

UC_Search <.. UC_Nav : <<extend>>
UC_Files <.. UC_Nav : <<extend>>
UC_Funcs <.. UC_Nav : <<extend>>
UC_Classes <.. UC_Nav : <<extend>>

UC_Graph <.. UC_Circ : <<extend>>
@enduml
```
*Viva Explanation*: The user interacts with CodeSeek by first analyzing a repository, which strictly includes uploading a ZIP. They can then independently use various explorers (Files, Functions, Classes, Graphs). Navigating directly to exact source lines extends searching or exploring. Circular dependency detection is an extended feature viewed within the graph interface.

---

## 2. Activity Diagram — Repository Analysis

**Purpose**: Details the complete control flow of the repository ingestion pipeline, from zip validation and extraction to AST parsing, SQLite storage, and sequential user exploration.

```plantuml
@startuml
start
:User uploads ZIP;
if (Is valid ZIP format?) then (yes)
  if (Are paths safe? (No Zip Slip)) then (yes)
    :Extract repository to Local Storage;
    :Determine analysis root folder;
    :Scanner Service: Recursively scan for .py files;
    
    while (More Python files to process?) is (yes)
      :Parser Service: Parse AST;
      if (Syntax Error?) then (no)
        :Extract symbols, imports, and calls;
      else (yes)
        :Record parse failure;
      endif
      :Persist data in SQLite;
    endwhile (no)
    
    :Complete indexing;
    :Return Project ID & Summary;
    :Show Dashboard;
    
    while (User continues exploring?) is (yes)
      :Choose exploration action;
      switch (Action)
      case ( Search )
        :Search Code;
      case ( Explore )
        :Explore Files / Classes / Functions;
      case ( Graphs )
        :View Dependency Graphs;
      case ( Stats )
        :View Statistics;
      endswitch
    endwhile (no)
    
  else (no)
    :Show Error (Unsafe ZIP);
  endif
else (no)
  :Show Error (Invalid ZIP);
endif
stop
@enduml
```
*Viva Explanation*: This shows the end-to-end flow. Crucially, it highlights security (Zip Slip validation) and fault tolerance: if one Python file has a syntax error, CodeSeek flags it as failed but continues parsing the rest of the repository without crashing. Upon completion, the user can sequentially choose various analysis actions.

---

## 3. Sequence Diagram — Upload & Indexing

**Purpose**: Shows the runtime messaging and module interactions during project ingestion, strictly reflecting `indexer.py` implementation where parsing occurs prior to file insertion.

```plantuml
@startuml
actor User
participant "React UI" as UI
participant "FastAPI App" as API
participant "Extracted Repo\nStorage" as Storage
participant "Indexer Service" as Indexer
participant "Scanner Service" as Scanner
participant "Parser Service" as Parser
database "SQLite DB" as DB

User -> UI: Uploads temp ZIP & clicks "Analyze"
UI -> API: POST /projects/analyze-upload
API -> API: Validate & check Zip Slip
API -> Storage: Extract ZIP
API -> Indexer: index_project()
Indexer -> DB: INSERT new project record

Indexer -> Scanner: scan_repository(extracted_path)
Scanner --> Indexer: List of .py files
loop for each .py file
  Indexer -> Parser: parse_file(file)
  Parser --> Indexer: parsed metadata / parse failure
  
  alt Parse Success
    Indexer -> DB: store file metadata/parse status
    Indexer -> DB: insert symbols
    Indexer -> DB: insert imports
    Indexer -> DB: insert calls
  else Syntax/Parse Failure
    Indexer -> DB: store file metadata with failed parse status / parse error
  end
end

Indexer --> API: returns project_id
API --> UI: JSON {project_id: ID}
UI -> API: GET /projects/{project_id}
API --> UI: Overview Stats (files, symbols, etc.)
UI --> User: Renders Dashboard Screen
@enduml
```
*Viva Explanation*: The ZIP is temporarily uploaded and extracted securely. The extracted repository is retained as local storage. The Indexer orchestrates the Scanner and Parser. Service modules are invoked sequentially, and data is aggressively persisted to SQLite. Raw source viewing uses SQLite's stored source data.

---

## 4. Sequence Diagram — Search & Source Navigation

**Purpose**: Focuses on the user capability of globally searching the structured index and navigating precisely to matched source code lines, optionally opening the File Explorer for deeper context.

```plantuml
@startuml
actor User
participant "Search UI" as UI
participant "FastAPI" as API
participant "Search Service" as Search
database "SQLite DB" as DB
participant "App Navigation" as Nav
participant "Explorer UI" as Explorer

User -> UI: Types search query
UI -> API: GET /projects/{id}/search?q=query
API -> Search: search_project(query)
Search -> DB: Execute exact/partial queries
DB --> Search: Query Results
Search -> Search: Calculate weighted ranking scores
Search --> API: Ranked Results JSON
API --> UI: Rendered Results List

User -> UI: Clicks a search result
UI -> Nav: Update navigation state

alt File Result
  Nav -> Explorer: Open File Explorer & select file
else Function/Method Result
  Nav -> Explorer: Open Function Explorer & select exact symbol
else Class Result
  Nav -> Explorer: Open Class Explorer & select exact class
end

opt If Function/Class Result selected
  User -> Explorer: Clicks "Open in File Explorer"
end

Explorer --> User: Open full source file, scroll to start line, highlight exact range
@enduml
```
*Viva Explanation*: When a user searches, the Search Service queries SQLite and applies structural ranking logic (e.g., exact class names score higher than raw text). Clicking a result triggers React state changes to open the appropriate explorer. For symbol results, users can optionally switch to the File Explorer, which scrolls and highlights the exact lines.

---

## 5. Conceptual Data Model Class Diagram

**Purpose**: Represents the core persisted entities in CodeSeek, matching the real schema from `backend/app/database/core.py` with simplified, strict compositional hierarchies.

```plantuml
@startuml
hide methods
hide circle
skinparam nodesep 100
skinparam ranksep 100

class Project {
  id : Integer
  name : String
  root_path : String
  indexed_at : Timestamp
}

class File {
  id : Integer
  relative_path : String
  language : String
  line_count : Integer
  source : Text
  parse_status : Boolean
  parse_error : Text
}

class Symbol {
  id : Integer
  deterministic_id : String
  name : String
  symbol_type : String
  start_line : Integer
  end_line : Integer
  parent_id : String
  parameters : JSON
  docstring : Text
  bases : JSON
}

class Import {
  id : Integer
  module : String
  imported_name : String
  alias : String
  line_number : Integer
}

class Call {
  id : Integer
  raw_callee_name : String
  line_number : Integer
}

Project "1" *-down- "*" File : contains >
File "1" *-down- "*" Symbol : declares >
File "1" *-down- "*" Import : includes >
File "1" *-down- "*" Call : makes >

Symbol "0..1" -right-> "0..*" Call : caller >
Symbol "0..1" -up-> "0..*" Symbol : parent/nested >
@enduml
```
*Viva Explanation*: Shows how the metadata is cleanly structured hierarchically. A single project is composed of many files. Each file acts as the primary parent composed of symbols, imports, and calls. Symbols additionally hold associations identifying which specific calls they make or which nested symbols they contain.

---

## 6. Component Diagram

**Purpose**: Shows the distinct architectural components, modules, external dependencies, and how they communicate orthogonally.

```plantuml
@startuml
skinparam nodesep 100
skinparam ranksep 100

package "Frontend Layer" {
  [React Frontend] as UI
  [React Flow\n<<visualization>>] as RFlow
}

package "API Layer" {
  [FastAPI Application] as API
}

package "Service Layer" {
  [Indexer Service] as Indexer
  [Scanner Service] as Scanner
  [Parser Service] as Parser
  [Search Service] as Search
  [Graph Service] as GraphSvc
}

package "Graph Dependency" {
  [NetworkX\n<<graph processing>>] as NX
}

package "Storage Layer" {
  folder "Local Extracted\nRepository Storage" as Storage
  database "SQLite Database" as DB
}

UI -right-> RFlow : renders dependency graphs
UI -down-> API : HTTP REST

API -down-> Indexer
API -down-> Search
API -down-> GraphSvc

API -down-> Storage : validate &\nextract ZIP
Indexer -down-> Scanner
Indexer -right-> Parser

Scanner -down-> Storage : reads .py files
Indexer -down-> DB : writes metadata
Search -down-> DB : queries indexed metadata
GraphSvc -down-> DB : reads relationships

GraphSvc -right-> NX : \n\ndirected graph operations,\nmetrics, cycle/self-loop analysis

Storage -[hidden]right- DB
Scanner -[hidden]right- Parser
@enduml
```
*Viva Explanation*: CodeSeek is highly modular. The frontend leverages React Flow for visualization. The FastAPI application groups and delegates logic to Python services (Scanner, Parser, Indexer). Graph logic relies on NetworkX for mathematical directed graph operations and cycle detection, while unresolved reference logic is owned purely by Graph Service.

---

## 7. Deployment Diagram

**Purpose**: Illustrates the physical/logical local deployment environment for CodeSeek, distinguishing browser execution from local dev servers.

```plantuml
@startuml
node "User Machine (Local Environment)" {
    node "Web Browser" {
        artifact "React Frontend App\n(executed in browser)" as FE
    }
    
    node "Local Services (localhost)" {
        component "Vite Dev Server\n(serves frontend)" as Vite
        component "FastAPI / Uvicorn\n(backend API)" as BE
    }
    
    node "Local File System" {
        database "SQLite Database\n(codeseek.db)" as DB
        folder "Uploads &\nExtracted Repositories" as FS
    }
    
    Vite -up-> FE : serves files
    FE -down-> BE : HTTP REST
    BE -down-> DB : SQLite Driver
    BE -down-> FS : File I/O
}
@enduml
```
*Viva Explanation*: CodeSeek currently runs locally. Its frontend executes in the browser (served locally by Vite), while the backend API, database, and repository data remain securely on the user's local machine.

---

## 8. Optional Entity Relationship Diagram (ERD)

**Purpose**: Alternative database schema visualization utilizing Mermaid.js.

```mermaid
erDiagram
    PROJECTS ||--o{ FILES : contains
    PROJECTS ||--o{ SYMBOLS : owns
    PROJECTS ||--o{ IMPORTS : owns
    PROJECTS ||--o{ CALLS : owns
    FILES ||--o{ SYMBOLS : declares
    FILES ||--o{ IMPORTS : includes
    FILES ||--o{ CALLS : makes

    PROJECTS {
        INTEGER id PK
        TEXT name
        TEXT root_path
    }
    FILES {
        INTEGER id PK
        INTEGER project_id FK
        TEXT relative_path
    }
    SYMBOLS {
        INTEGER id PK
        TEXT deterministic_id
        INTEGER file_id FK
        TEXT name
        TEXT symbol_type
    }
    IMPORTS {
        INTEGER id PK
        INTEGER file_id FK
        TEXT module
        TEXT imported_name
    }
    CALLS {
        INTEGER id PK
        INTEGER file_id FK
        TEXT raw_callee_name
    }
```
