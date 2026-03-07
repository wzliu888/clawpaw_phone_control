import { randomUUID } from 'crypto';
import { UserRepository, User } from '../repositories/user.repository';
import { SecretService } from './secret.service';
import { VipService } from './vip.service';

// Business logic layer — anonymous device registration
export class AuthService {
  private userRepository: UserRepository;
  private secretService: SecretService;
  private vipService: VipService;

  constructor() {
    this.userRepository = new UserRepository();
    this.secretService = new SecretService();
    this.vipService = new VipService();
  }

  async loginAnonymous(): Promise<{ user: User; secret: string }> {
    const user = await this.userRepository.create('anonymous', randomUUID());
    const secretRow = await this.secretService.generateSecret(user.uid);
    await this.vipService.grantTrial(user.uid);
    return { user, secret: secretRow.secret };
  }
}
