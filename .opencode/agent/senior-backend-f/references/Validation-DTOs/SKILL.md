# Skill: Validation & DTOs

## Trigger

Use when the request mentions **DTOs, validation, pipes, request parsing, input shape, transformation, or payload constraints**.

---

## Scope

- Global `ValidationPipe` configuration
- DTO design with `class-validator` + `class-transformer`
- Nested DTOs and nested validation
- Partial updates (`PartialType`, `OmitType`, `PickType`)
- Custom validators
- Transforming incoming data types
- Enum validation
- File upload validation
- Consistent error message formatting

---

## Global ValidationPipe Setup

```typescript
// main.ts
import { ValidationPipe } from '@nestjs/common';

app.useGlobalPipe(
  new ValidationPipe({
    whitelist: true,              // strip unknown properties
    forbidNonWhitelisted: true,   // throw if unknown properties present
    transform: true,              // auto-transform to DTO class instances
    transformOptions: {
      enableImplicitConversion: true, // coerce query params from string
    },
    errorHttpStatusCode: 422,     // 422 Unprocessable Entity for validation errors
  }),
);
```

---

## Base DTO Patterns

### Create DTO

```typescript
// dto/create-user.dto.ts
import {
  IsEmail, IsString, MinLength, MaxLength,
  IsEnum, IsOptional, Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { Role } from '@prisma/client';

export class CreateUserDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  @Transform(({ value }) => value.toLowerCase().trim())
  email: string;

  @ApiProperty({ minLength: 8, maxLength: 72 })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message: 'Password must contain uppercase, lowercase, and a digit',
  })
  password: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @Transform(({ value }) => value?.trim())
  name: string;

  @ApiPropertyOptional({ enum: Role, default: Role.USER })
  @IsOptional()
  @IsEnum(Role)
  role?: Role = Role.USER;
}
```

### Update DTO (Partial)

```typescript
// dto/update-user.dto.ts
import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateUserDto } from './create-user.dto';

// Partial = all fields optional; OmitType = exclude password from update DTO
export class UpdateUserDto extends PartialType(
  OmitType(CreateUserDto, ['password'] as const),
) {}
```

### Password Change DTO (separate concern)

```typescript
export class ChangePasswordDto {
  @IsString()
  @MinLength(8)
  currentPassword: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
  newPassword: string;
}
```

---

## Nested DTOs

```typescript
export class AddressDto {
  @IsString()
  @MaxLength(200)
  street: string;

  @IsString()
  @MaxLength(100)
  city: string;

  @IsString()
  @Length(2, 2)
  countryCode: string;

  @IsPostalCode('any')
  postalCode: string;
}

export class CreateOrderDto {
  @IsUUID()
  userId: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];

  @ValidateNested()
  @Type(() => AddressDto)
  shippingAddress: AddressDto;

  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod;
}

export class OrderItemDto {
  @IsUUID()
  productId: string;

  @IsInt()
  @Min(1)
  @Max(100)
  quantity: number;
}
```

`@ValidateNested({ each: true })` + `@Type(...)` is mandatory for nested validation. Without `@Type`, class-transformer won't instantiate the nested class and validation will silently pass.

---

## Query Parameter DTOs

```typescript
export class SearchUsersDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }) => value?.trim())
  q?: string;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}
```

Query params arrive as strings — `@Type(() => Number)` with `enableImplicitConversion: true` handles coercion.

---

## Custom Validators

```typescript
// validators/is-strong-password.validator.ts
import {
  ValidatorConstraint, ValidatorConstraintInterface,
  ValidationArguments, registerDecorator, ValidationOptions,
} from 'class-validator';

@ValidatorConstraint({ name: 'isStrongPassword', async: false })
export class IsStrongPasswordConstraint implements ValidatorConstraintInterface {
  validate(value: string): boolean {
    return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{12,}$/.test(value);
  }

  defaultMessage(_args: ValidationArguments): string {
    return 'Password must be 12+ chars with upper, lower, digit, and symbol';
  }
}

export function IsStrongPassword(options?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options,
      validator: IsStrongPasswordConstraint,
    });
  };
}
```

```typescript
// Usage
@IsStrongPassword()
password: string;
```

### Async Validator (DB check example)

```typescript
@ValidatorConstraint({ name: 'isEmailUnique', async: true })
@Injectable()
export class IsEmailUniqueConstraint implements ValidatorConstraintInterface {
  constructor(private readonly prisma: PrismaService) {}

  async validate(email: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    return !user;
  }

  defaultMessage(): string {
    return 'Email is already registered';
  }
}
```

Register in module providers and enable `useContainer(app.select(AppModule), { fallbackOnErrors: true })` in `main.ts` so class-validator can resolve the injectable.

---

## Transformation Examples

```typescript
// Normalize phone number
@Transform(({ value }) => value?.replace(/\D/g, ''))
@Matches(/^\d{10,15}$/)
phone: string;

// Ensure array even if single value passed
@Transform(({ value }) => (Array.isArray(value) ? value : [value]))
@IsArray()
tags: string[];

// Parse JSON string from form-data
@Transform(({ value }) => {
  try { return JSON.parse(value); } catch { return value; }
})
metadata: Record<string, unknown>;
```

---

## Notes

- **Never validate inside a service by hand** (e.g., `if (!dto.email)...`). The DTO + ValidationPipe should reject bad input before it reaches the service layer.
- **`whitelist: true` is your first line of defense** against mass assignment — it strips any property not declared in the DTO class.
- **Swagger decorators are not optional** on production APIs — they document the contract and make `@nestjs/swagger` generate accurate OpenAPI specs.
- **Separate DTOs per use case** — don't reuse a `CreateUserDto` as the update payload. Use `PartialType` / `OmitType` / `PickType` from `@nestjs/mapped-types` (or `@nestjs/swagger` for Swagger-aware variants).
- **`@IsOptional()` must come before other decorators** or class-validator will still run the downstream validators on `undefined`.
