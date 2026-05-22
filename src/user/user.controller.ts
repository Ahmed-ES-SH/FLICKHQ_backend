import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
  ParseIntPipe,
  HttpStatus,
} from '@nestjs/common';
import { UserService } from './user.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { User } from './schema/user.entity';
import { Roles } from 'src/auth/decorators/Roles.decorator';
import { UserRoleEnum } from 'src/auth/types/UserRoleEnum';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Public } from 'src/auth/decorators/public.decorator';
import { FilterOptionsDto } from './dto/filter-options.dto';
import { PaginatedResult } from 'src/helpers/paginate.helper';
import { GetUser } from 'src/auth/decorators/current-user.decorator';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';

@ApiTags('Users')
@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Public()
  @Post()
  @ApiOperation({ summary: 'Register a new user' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'User successfully registered',
    type: User,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'User already exists or invalid input',
  })
  create(@Body() createUserDto: CreateUserDto): Promise<User> {
    return this.userService.create(createUserDto);
  }

  @Public()
  @Post('verify-email')
  @ApiOperation({ summary: 'Verify user email with token' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Email successfully verified',
    type: User,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Invalid verification token',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Verification token has expired',
  })
  verifyEmail(@Body() verifyEmailDto: VerifyEmailDto): Promise<User> {
    return this.userService.verifyEmail(verifyEmailDto.token);
  }

  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Get()
  @Roles(UserRoleEnum.ADMIN)
  @ApiOperation({
    summary: 'Get all users (Admin only, paginated with filters)',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Paginated list of users',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Not authenticated',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Admin role required',
  })
  findAll(@Query() query: FilterOptionsDto): Promise<PaginatedResult<User>> {
    return this.userService.findAll(query);
  }

  @ApiBearerAuth()
  @Get('stats')
  @UseGuards(RolesGuard)
  @Roles(UserRoleEnum.ADMIN)
  @ApiOperation({ summary: 'Get user statistics (Admin only)' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'User statistics',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Admin role required',
  })
  stats(): Promise<{
    adminsNumber: number;
    verifiedUsersNumber: number;
    unverifiedUsersNumber: number;
  }> {
    return this.userService.stats();
  }

  @ApiBearerAuth()
  @Get(':id')
  @ApiParam({ name: 'id', type: Number, description: 'User ID' })
  @ApiOperation({
    summary: 'Get user by ID (Admins: any user; Users: own profile)',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'User found',
    type: User,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'User not found',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Cannot view another user profile',
  })
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @GetUser() currentUser: User,
  ): Promise<User> {
    return this.userService.findOne(id, currentUser);
  }

  @ApiBearerAuth()
  @Patch(':id')
  @ApiParam({ name: 'id', type: Number, description: 'User ID' })
  @ApiOperation({
    summary: 'Update user (Admins: any user; Users: own profile)',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'User successfully updated',
    type: User,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'User not found',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Cannot update another user profile',
  })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateUserDto: UpdateUserDto,
    @GetUser() currentUser: User,
  ): Promise<User> {
    return this.userService.update(id, updateUserDto, currentUser);
  }

  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Delete(':id')
  @Roles(UserRoleEnum.ADMIN)
  @ApiParam({ name: 'id', type: Number, description: 'User ID' })
  @ApiOperation({ summary: 'Delete user (Admin only)' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'User successfully deleted',
    type: User,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'User not found',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Admin role required',
  })
  remove(@Param('id', ParseIntPipe) id: number): Promise<User> {
    return this.userService.remove(id);
  }
}
