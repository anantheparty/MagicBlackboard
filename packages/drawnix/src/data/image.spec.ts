import { describe, expect, it, vi } from 'vitest';
import { MAX_EMBEDDED_IMAGE_FILE_BYTES } from '../constants';
import { getDataURL } from './blob';
import { insertImage, insertImageWithFeedback } from './image';

describe('embedded image source limits', () => {
  it('rejects an oversized image before FileReader allocates a data URL', async () => {
    const image = new File(['synthetic'], 'oversized.png', {
      type: 'image/png',
    });
    Object.defineProperty(image, 'size', {
      configurable: true,
      value: MAX_EMBEDDED_IMAGE_FILE_BYTES + 1,
    });
    const readAsDataURL = vi.spyOn(FileReader.prototype, 'readAsDataURL');

    await expect(getDataURL(image)).rejects.toThrow('image file is too large');
    expect(readAsDataURL).not.toHaveBeenCalled();
  });

  it('rejects direct insertion before reading board or decoding image state', async () => {
    const image = new File(['synthetic'], 'oversized.png', {
      type: 'image/png',
    });
    Object.defineProperty(image, 'size', {
      configurable: true,
      value: MAX_EMBEDDED_IMAGE_FILE_BYTES + 1,
    });
    const readAsDataURL = vi.spyOn(FileReader.prototype, 'readAsDataURL');

    await expect(insertImage({} as never, image)).rejects.toThrow('image file is too large');
    expect(readAsDataURL).not.toHaveBeenCalled();
  });

  it('surfaces an oversized direct insertion through the board toast seam', async () => {
    const image = new File(['synthetic'], 'oversized.png', { type: 'image/png' });
    Object.defineProperty(image, 'size', {
      configurable: true,
      value: MAX_EMBEDDED_IMAGE_FILE_BYTES + 1,
    });
    const showToast = vi.fn();

    insertImageWithFeedback({ showToast } as never, image);
    await vi.waitFor(() => expect(showToast).toHaveBeenCalledOnce());

    expect(showToast).toHaveBeenCalledWith({
      type: 'error',
      message: '无法插入图片',
      description: '图片大小不能超过 8 MB。',
    });
  });
});
