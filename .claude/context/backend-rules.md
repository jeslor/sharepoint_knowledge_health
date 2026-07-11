# Backend Rules

NestJS Structure

module

controller

service

repository

Controllers:

- validate requests
- call services
- return responses

Services:

- contain business logic

Never:

put database queries inside controllers

put business rules inside DTOs
