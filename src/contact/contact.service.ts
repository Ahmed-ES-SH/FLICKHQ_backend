import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ContactMessage } from './schema/contact-message.schema';
import { CreateContactMessageDto } from './dto/create-contact-message.dto';
import { ContactQueryDto } from './dto/contact-query.dto';

@Injectable()
export class ContactService {
  constructor(
    @InjectRepository(ContactMessage)
    private readonly contactMessageRepository: Repository<ContactMessage>,
  ) {}

  async create(
    dto: CreateContactMessageDto,
    ipAddress: string,
  ): Promise<{ message: string; id: string }> {
    const entity = this.contactMessageRepository.create({
      fullName: dto.fullName,
      email: dto.email,
      subject: dto.subject,
      message: dto.message,
      ipAddress,
    });

    const saved = await this.contactMessageRepository.save(entity);

    return {
      message: 'Your message has been sent successfully',
      id: saved.id,
    };
  }

  private async findOneOrFail(id: string): Promise<ContactMessage> {
    const message = await this.contactMessageRepository.findOne({
      where: { id },
    });

    if (!message) {
      throw new NotFoundException('Contact message not found');
    }

    return message;
  }

  async findAll(query: ContactQueryDto): Promise<{
    data: ContactMessage[];
    meta: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  }> {
    const {
      page = 1,
      limit = 10,
      sortBy = 'createdAt',
      order = 'DESC',
      isRead,
    } = query;

    const where: Record<string, unknown> = {};
    if (isRead !== undefined) {
      where.isRead = isRead;
    }

    const [data, total] = await this.contactMessageRepository.findAndCount({
      where,
      skip: (page - 1) * limit,
      take: limit,
      order: { [sortBy]: order },
    });

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string): Promise<ContactMessage> {
    return this.findOneOrFail(id);
  }

  async markAsRead(
    id: string,
  ): Promise<{ id: string; isRead: boolean; message: string }> {
    const result = await this.contactMessageRepository.update(id, {
      isRead: true,
    });
    if (result.affected === 0) {
      throw new NotFoundException('Contact message not found');
    }

    return {
      id,
      isRead: true,
      message: 'Message marked as read',
    };
  }

  async markAsReplied(id: string): Promise<{
    id: string;
    isRead: boolean;
    repliedAt: Date;
    message: string;
  }> {
    const repliedAt = new Date();
    const result = await this.contactMessageRepository.update(id, {
      isRead: true,
      repliedAt,
    });
    if (result.affected === 0) {
      throw new NotFoundException('Contact message not found');
    }

    return {
      id,
      isRead: true,
      repliedAt,
      message: 'Message marked as replied',
    };
  }

  async remove(id: string): Promise<{ message: string }> {
    const result = await this.contactMessageRepository.delete(id);
    if (result.affected === 0) {
      throw new NotFoundException('Contact message not found');
    }

    return { message: 'Contact message deleted successfully' };
  }
}
