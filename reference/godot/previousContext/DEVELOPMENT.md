# Freedom MMORPG Development Guide

## Overview

Freedom is an ambitious MMORPG project that aims to create a living, breathing virtual world. This guide will help you understand the architecture and contribute to the project.

## Architecture Overview

### Core Systems

1. **World Engine** (`freedom/world/`)
   - Procedural generation using noise algorithms
   - Chunk-based world management
   - Biome and terrain generation

2. **NPC AI Engine** (`freedom/npc/`)
   - LLM-driven character behavior
   - Relationship networks
   - Goal-oriented decision making

3. **Economy Engine** (`freedom/economy/`)
   - Dynamic supply and demand
   - Market events and volatility
   - NPC economic behavior

4. **Server Infrastructure** (`freedom/server/`)
   - WebSocket-based networking
   - World state management
   - Player session handling

5. **Game Client** (`freedom/client/`)
   - Pygame-based rendering
   - Input handling
   - Network communication

### Data Flow

```
Client <-> WebSocket <-> World Server <-> Core Systems
                                    |
                                    v
                              Database/Redis
```

## Getting Started

### Prerequisites

- Python 3.8+
- PostgreSQL
- Redis
- OpenAI/Anthropic API keys (for AI features)

### Installation

1. Clone the repository
2. Install dependencies: `pip install -r requirements.txt`
3. Copy `env_example.txt` to `.env` and configure
4. Set up PostgreSQL and Redis
5. Run the server: `python launch.py server`
6. Run the client: `python launch.py client`

## Development Workflow

### Adding New Features

1. **Identify the system** that needs modification
2. **Create/update types** in `freedom/core/types.py`
3. **Implement the feature** in the appropriate module
4. **Add tests** (when test framework is added)
5. **Update documentation**

### Code Style

- Use type hints throughout
- Follow PEP 8 for formatting
- Use async/await for I/O operations
- Document all public methods
- Use logging for debugging

### Testing

Currently, the project doesn't have a test framework, but it should be added. Consider:
- `pytest` for unit tests
- `pytest-asyncio` for async tests
- Integration tests for server-client communication

## Extending the System

### Adding New Biomes

1. Add biome type to `BiomeType` enum
2. Update biome parameters in `WorldGenerator`
3. Add biome-specific colors and properties
4. Update terrain generation logic

### Adding New NPC Behaviors

1. Extend the `NPC` class in types
2. Add new states to `NPCState` enum
3. Implement behavior logic in `NPCAIEngine`
4. Update goal generation system

### Adding New Items

1. Create item in the `Item` class
2. Add to economy engine
3. Implement crafting/usage logic
4. Add to world generation

### Adding New Combat Types

1. Extend `CombatType` enum
2. Implement combat logic
3. Add to client rendering
4. Update server handling

## Performance Considerations

### Server-Side

- Use async I/O for all operations
- Implement proper connection pooling
- Cache frequently accessed data
- Use background tasks for heavy operations

### Client-Side

- Implement proper culling for rendering
- Use efficient data structures
- Minimize network requests
- Implement proper error handling

### World Generation

- Use efficient noise algorithms
- Implement proper chunk caching
- Generate chunks on-demand
- Use background threads for generation

## Networking

### Protocol

The game uses WebSockets with JSON messages:

```json
{
  "type": "message_type",
  "data": {...}
}
```

### Message Types

- `auth`: Player authentication
- `player_move`: Player movement
- `player_action`: Player actions
- `chat_message`: Chat messages
- `request_chunk`: Chunk data requests

### Adding New Messages

1. Define message structure
2. Add handling in server
3. Add handling in client
4. Update documentation

## Database Schema

### Core Tables

- `players`: Player information
- `npcs`: NPC data
- `world_chunks`: World chunk data
- `items`: Item definitions
- `transactions`: Economic transactions
- `relationships`: NPC relationships

### Adding New Tables

1. Define the table structure
2. Create migration scripts
3. Update models in types
4. Add database operations

## AI Integration

### Current Implementation

- Basic goal generation
- Simple decision making
- Relationship management

### Future Enhancements

- LLM integration for complex behaviors
- Dynamic story generation
- Adaptive NPC personalities
- Context-aware interactions

## Security Considerations

### Current

- Basic input validation
- WebSocket authentication

### Future

- Rate limiting
- Input sanitization
- Anti-cheat measures
- Secure communication

## Monitoring and Debugging

### Logging

The project uses `loguru` for logging:

```python
from loguru import logger

logger.info("Information message")
logger.debug("Debug message")
logger.error("Error message")
```

### Metrics

Consider adding:
- Player count monitoring
- Performance metrics
- Error tracking
- Usage analytics

## Deployment

### Development

- Run locally with `launch.py`
- Use default configuration
- Debug with logging

### Production

- Use proper environment variables
- Set up monitoring
- Implement proper security
- Use production databases
- Set up load balancing

## Contributing

### Guidelines

1. **Fork the repository**
2. **Create a feature branch**
3. **Implement your changes**
4. **Add tests** (when available)
5. **Update documentation**
6. **Submit a pull request**

### Areas Needing Work

- Combat system implementation
- Crafting system
- Quest system
- Advanced AI behaviors
- Performance optimization
- Test coverage
- Documentation

## Troubleshooting

### Common Issues

1. **Import errors**: Check Python path and dependencies
2. **Connection refused**: Verify server is running
3. **Performance issues**: Check chunk size and render distance
4. **Memory issues**: Reduce chunk cache size

### Debug Mode

Enable debug logging by setting log level in configuration.

## Future Roadmap

### Short Term

- Basic combat system
- Item crafting
- Simple quests
- Performance optimization

### Medium Term

- Advanced AI behaviors
- Dynamic events
- Player housing
- Guild system

### Long Term

- Multiple worlds
- Advanced story generation
- VR support
- Mobile client

## Resources

- [Pygame Documentation](https://www.pygame.org/docs/)
- [WebSockets Documentation](https://websockets.readthedocs.io/)
- [AsyncIO Documentation](https://docs.python.org/3/library/asyncio.html)
- [Pydantic Documentation](https://pydantic-docs.helpmanual.io/)

## Support

For questions and support:
- Check the documentation
- Review the code
- Open an issue on GitHub
- Join the community discussions

---

**Note**: This is a living document. Update it as the project evolves.
