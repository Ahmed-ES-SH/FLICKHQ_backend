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
} from '@nestjs/common';
import { UserService } from './user.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User } from './schema/user.schema';
import { Roles } from 'src/auth/decorators/Roles.decorator';
import { UserRoleEnum } from 'src/auth/types/UserRoleEnum';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { AuthGuard } from 'src/auth/guards/auth.guard';
import { Public } from 'src/auth/decorators/public.decorator';
import { FilterOptionsDto } from './dto/filter-options.dto';
import { PaginatedResult } from 'src/helpers/paginate.helper';

@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  /**
   * Create a new user (Registration)
   * @param createUserDto
   * @returns {Promise<User>}
   */
  @Public()
  @Post()
  create(@Body() createUserDto: CreateUserDto): Promise<User> {
    return this.userService.create(createUserDto);
  }

  /**
   * Get all users
   * @returns {Promise<User[]>}
   */
  @UseGuards(AuthGuard, RolesGuard)
  @Get()
  @Roles(UserRoleEnum.ADMIN)
  findAll(@Query() query: FilterOptionsDto): Promise<PaginatedResult<User>> {
    return this.userService.findAll(query, query);
  }

  /**
   * Get users stats
   * @returns {Promise<any>}
   */
  @Get('stats')
  @Roles(UserRoleEnum.ADMIN)
  @UseGuards(AuthGuard, RolesGuard)
  stats() {
    return this.userService.stats();
  }

  /**
   * Get user by id
   * @param id
   * @returns {Promise<User | null>}
   */
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number): Promise<User | null> {
    return this.userService.findOne(id);
  }

  /**
   * Update user
   * @param id
   * @param updateUserDto
   * @returns {Promise<User>}
   */
  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateUserDto: UpdateUserDto,
  ): Promise<User> {
    return this.userService.update(id, updateUserDto);
  }

  /**
   * Delete user
   * @param id
   * @returns {Promise<User>}
   */
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number): Promise<User> {
    return this.userService.remove(id);
  }
}
