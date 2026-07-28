import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { EmployeesService } from './employees.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';

const MAX_PHOTO_SIZE_BYTES = 5 * 1024 * 1024;

@Controller()
@UseGuards(JwtAuthGuard)
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Get('employees/me')
  me() {
    return this.employees.me();
  }

  @Get('employees')
  list() {
    return this.employees.list();
  }

  @Get('employees/:id')
  findOne(@Param('id') id: string) {
    return this.employees.findOne(id);
  }

  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  @Post('employees')
  create(@Body() dto: CreateEmployeeDto) {
    return this.employees.create(dto);
  }

  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  @Patch('employees/:id')
  update(@Param('id') id: string, @Body() dto: UpdateEmployeeDto) {
    return this.employees.update(id, dto);
  }

  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  @Delete('employees/:id')
  remove(@Param('id') id: string) {
    return this.employees.remove(id);
  }

  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  @Post('employees/:id/photo')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_PHOTO_SIZE_BYTES } }))
  uploadPhoto(@Param('id') id: string, @UploadedFile() file: { mimetype: string; size: number; buffer: Buffer } | undefined) {
    if (!file) throw new BadRequestException({ error: 'file_required', message: 'Choose a photo to upload.' });
    return this.employees.uploadPhoto(id, file);
  }

  @Get('departments')
  listDepartments() {
    return this.employees.listDepartments();
  }

  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  @Post('departments')
  createDepartment(@Body() dto: CreateDepartmentDto) {
    return this.employees.createDepartment(dto);
  }

  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  @Patch('departments/:id')
  updateDepartment(@Param('id') id: string, @Body() dto: UpdateDepartmentDto) {
    return this.employees.updateDepartment(id, dto);
  }

  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  @Get('departments/:id/usage')
  departmentUsage(@Param('id') id: string) {
    return this.employees.departmentUsageCount(id).then((count) => ({ count }));
  }

  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  @Delete('departments/:id')
  deleteDepartment(@Param('id') id: string) {
    return this.employees.deleteDepartment(id);
  }
}
