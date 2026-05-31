# Freedom MMORPG

**Unity 6.2 + Fish-Networking + .NET 8 Server Architecture**

## Quick Start

### Prerequisites
- Unity 6.2 (6000.2.1f1) with 2D template
- .NET 8.0 SDK
- Fish-Networking package

### Project Structure

```
FreedomMMORPG/
├── client/          # Unity 6.2 project
├── server/          # .NET 8 authoritative server  
├── tools/           # Python asset pipeline & validation
├── data/            # JSON game configuration
├── assets/          # Generated sprites & assets
├── infra/           # Docker & deployment
└── docs/            # Architecture documentation
```

### Development Setup

1. **Server:** `cd server/FreedomServer && dotnet run`
2. **Client:** Open `client/` in Unity 6.2
3. **Tools:** `cd tools && python -m venv venv && venv\Scripts\activate`

### Next Steps

1. Open Unity Hub and create new 2D project in `client/` directory
2. Install Fish-Networking package
3. Run server and connect first client

---

*Transitioning from Python prototype to production Unity + server architecture*