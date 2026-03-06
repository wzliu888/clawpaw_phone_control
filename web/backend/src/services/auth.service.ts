import { UserRepository, User } from '../repositories/user.repository';
import { SecretService } from './secret.service';

// Business logic layer — anonymous device registration
export class AuthService {
  private userRepository: UserRepository;
  private secretService: SecretService;

  constructor() {
    this.userRepository = new UserRepository();
    this.secretService = new SecretService();
  }

  async loginAnonymous(): Promise<{ user: User; secret: string }> {
    const user = await this.userRepository.create('anonymous', '');
    const secretRow = await this.secretService.generateSecret(user.uid);
    return { user, secret: secretRow.secret };
  }
}
